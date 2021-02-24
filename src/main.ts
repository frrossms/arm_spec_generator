// Mutability of fields
// This is used to express the x-ms-mutability property on fields.
export enum Mutability { Create = "create", Read = "read", Write = "write" }

export const ReadOnly = new Set([Mutability.Read])
export const CreateOnly = new Set([Mutability.Create])
export const Immutable = new Set([Mutability.Create, Mutability.Read])
export const WriteOnly = new Set([Mutability.Create, Mutability.Write])

export function serializeMutability(mt: Set<Mutability>): Array<string> {
    return Array.from(mt).sort();
}


// API Versions
export type Version = [number, number, number];
export enum VersionKind { Preview, GA }
export type TargetVersion = [Version, VersionKind];
export interface Versioned {
    previewVersion: Version,
    gaVersion?: Version
}

export function serializeVersion(version: TargetVersion): string {
    const [[year,month,day], kind] = version;
    const pad = (n: number) => n < 10 ? "0" + n : n.toString();
    let versionString = `${year}-${pad(month)}-${pad(day)}`
    if (kind == VersionKind.Preview) {
        versionString += "-preview";
    }
    return versionString;
}

export function inVersion(targetVersion: TargetVersion, it: Versioned): boolean {
    const [version, kind] = targetVersion;
    if (kind == VersionKind.Preview) {
        return it.previewVersion <= version;
    } else if (it.gaVersion != undefined) {
        return it.gaVersion <= version;
    } else {
        return false;
    }
}

// Field types
interface RequiredField { required?: boolean }

interface BoolField { kind: "bool" }
interface StringField { kind: "string" }
interface Int32Field { kind: "int32" }
interface Int64Field { kind: "int64" }
interface FloatField { kind: "float" }
interface ArrayField { kind: "array", elementKind: FieldType }
interface ObjectField { kind: "object", properties: Record<string, Property&RequiredField> }
interface SecretField { kind: "secret", innerKind: FieldType }
interface EnumField { kind: "enum", values: Array<string> }

export type FieldType = 
    | BoolField
    | StringField
    | Int32Field
    | Int64Field
    | FloatField
    | ArrayField
    | ObjectField
    | SecretField
    | EnumField

export const BoolT: BoolField = { kind: "bool" }
export const StringT: StringField = { kind: "string" }
export const Int32T: Int32Field = { kind: "int32" }
export const Int64T: Int64Field = { kind: "int64" }
export const FloatT: FloatField = { kind: "float" }
export function ArrayT(t: FieldType): ArrayField { return { kind: "array", elementKind: t } }
export function ObjectT(ps: Record<string, Property&RequiredField>): ObjectField { return { kind: "object", properties: ps }; }
export function SecretT(t: FieldType): SecretField { return { kind: "secret", innerKind: t } }
export function EnumT(vs: Array<string>): EnumField { return { kind: "enum", values: vs } }

export interface Property extends Versioned {
    description: string;
    type: FieldType;
    mutability?: Set<Mutability>;
}

function serializeFieldType(name: string, targetVersion: TargetVersion, ft: FieldType, target: Record<string, unknown>) {
    switch (ft.kind) {
        case "string":
            target.type = "string";
            break;
        case "bool":
            target.type = "boolean";
            break;
        case "int32":
            target.type = "integer";
            target.format = "int32";
            break;
        case "int64":
            target.type = "integer";
            target.format = "int64";
            break;
        case "float":
            target.type = "number";
            target.format = "double";
            break;
        case "enum":
            target.type = "string";
            target.enum = ft.values;
            target["x-ms-enum"] = {
                modelAsString: true,
                name: name.charAt(0).toUpperCase() + name.slice(1) + "Enum",
            };
            break;
        case "secret":
            target["x-ms-secret"] = true;
            if (ft.innerKind.kind == "secret") {
                throw Error("Inner kind of SecretT must not be secret.");
            }
            serializeFieldType(name, targetVersion, ft.innerKind, target);
            break;
        case "array":
            target.type = "array";
            {
                const subTarget = {}
                serializeFieldType(name, targetVersion, ft.elementKind, subTarget);
                target.items = subTarget;
            }
            break;
        case "object":
            target.type = "object";
            target.properties = {};
            {
                const requiredProperties = [];
                const properties: Record<string, unknown> = {}
                for (const propertyName in ft.properties) {
                    const pr = ft.properties[propertyName];
                    const sp = serializeProperty(propertyName, targetVersion, pr);
                    if (sp != null) {
                        properties[propertyName] = sp;
                    }
                    if (pr?.required) {
                        requiredProperties.push(propertyName);
                    }
                }
                target.properties = properties;
                if (requiredProperties.length > 0) {
                    target.required = requiredProperties;
                }
            }
            break;
        }
    }


export function serializeProperty(name: string, targetVersion: TargetVersion, p: Property): Record<string,unknown>|null {
    if (name == null || name.length == 0) {
        throw Error("name must be nonempty.");
    }

    if (!inVersion(targetVersion, p)) {
        return null;
    }

    const r: Record<string, unknown> = {
        description: p.description
    };
    
    // Mutability
    const isReadable = p.mutability == undefined || p.mutability.has(Mutability.Read)
    const isSecret = p.type.kind == "secret";
    if (isSecret && isReadable) {
        throw Error('Secret properties must not be readable.');
    } else if (!isSecret && !isReadable) {
        throw Error('All non-secret properties must be readable.');
    } else if (p.mutability == ReadOnly) {
        r['x-ms-mutability'] = ["read"];
        r['readOnly'] = true;
    } else if (p.mutability != undefined) {
        r['x-ms-mutability'] = serializeMutability(p.mutability);
    }

    serializeFieldType(name, targetVersion, p.type, r);


    return r;
}


interface Method extends Versioned {
    description: string,
    returnType: FieldType,
    example: Record<string, unknown>,
}

interface ParameterSegment { 
    name: string,
    minLength?: number,
    maxLength?: number,
    pattern?: string,
}

type Path = Array<[string, ParameterSegment]>

enum ResourceType { Tracked, Proxy }

interface ResourceExample {
    parameters: Array<string>,
    properties: Record<string, unknown>
}

interface Resource extends Versioned {
    path: Path;
    resourceKind: ResourceType;
    readableName: string;
    examples: [ResourceExample];
    properties: Record<string, Property>;
    methods?: Record<string, Method>;
    asyncMethods?: Record<string, Method>;
}

interface Module extends Versioned {
    name: string;
    resourceProvider: string;
    resources: Array<Resource>;
    suppressions?: Record<string, string>;
}

function resourceType(path: Path): string {
    const segment = path[path.length-1][0];
    return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function flatten(path: Path): string {
    return path.map(
        segmentPair => `${segmentPair[0]}/{${segmentPair[1]}}`
    ).join("/")
}

function serializeModule(module: Module, targetVersion: TargetVersion): Record<string,unknown>|null {
    if (!inVersion(targetVersion, module)) { // Fix with inVersion
        return null; // Generating a version before this module was defined.
    }
    
    // This is fixed preamble.
    const obj = {
        "swagger": "2.0",
        "info": {
          "title": "Cosmos DB",
          "description": "Azure Cosmos DB Database Service Resource Provider REST API",
          "version": serializeVersion(targetVersion)
        },
        "host": "management.azure.com",
        "schemes": [
          "https"
        ],
        "consumes": [
          "application/json"
        ],
        "produces": [
          "application/json"
        ],
        "security": [
          {
            "azure_auth": [
              "user_impersonation"
            ]
          }
        ],
        "securityDefinitions": {
          "azure_auth": {
            "type": "oauth2",
            "authorizationUrl": "https://login.microsoftonline.com/common/oauth2/authorize",
            "flow": "implicit",
            "description": "Azure Active Directory OAuth2 Flow",
            "scopes": {
              "user_impersonation": "Impersonate your user account"
            }
          }
        },
        "paths": {},
        "parameters": {},
        "definitions": {}
    };

    module.resources.forEach(resource => {
        const path = flatten(resource.path);
        const rt = resourceType(resource.path);

        // TODO: Insert parameters into obj.parameters and references to them in operationParameters
        const operationParameters: Array<Record<string,unknown>> = [
            {
                "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter"
            },
            {
                "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter"
            },
            {
                "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter"
            }
        ]
        // TODO: Add apiVersion parameter

        // TODO: Generate definition from parameters and insert into obj.definitions

        const vs = {
            put: {
                operationId: `${rt}_CreateOrUpdate`
            },
            get: {
                operationId: `${rt}_Get`
            },
            delete: {
                operationId: `${rt}_Update`,
                description: `Deletes an existing ${resource.readableName}`,
                "x-ms-long-running-operation": true,
                parameters: operationParameters,
                responses: {
                    "202": {
                        "description": `Deleting the ${resource.readableName} will complete asynchronously.`
                    },
                    "204": {
                        "description": `The specified ${resource.readableName} does not exist.`
                    }
                }
            },
            patch: {
                operationId: `${rt}_Update`,
                description: `Updates the properties of an existing ${resource.readableName}.`,
                "x-ms-long-running-operation": true,
                parameters: operationParameters.concat([
                    {
                        name: "updateParameters",
                        in: "body",
                        required: true,
                        schema: {
                            "$ref": "#/definitions/..."
                        },
                        description: `The parameters to provide for the current ${resource.readableName}.`
                    }
                ]),
                reponses: {
                    "200": {
                        "description": `The updates to the ${resource.readableName} will complete asynchronously.`
                    }
                }
            }
        }

        //obj.paths[path] = vs

        // TODO: Add generation of methods and async methods

        // TODO: Add generation of example files
    });

    return obj;
}
