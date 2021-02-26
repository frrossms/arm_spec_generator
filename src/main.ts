export function concatObjects(objs: Array<Record<string,unknown>>): Record<string,unknown> {
    const result: Record<string,unknown> = {}
    objs.forEach(obj => {
        for (const key in obj) {
            if (result.hasOwnProperty(key)) {
                throw Error(`Multiple objects provide key ${key}.`)
            } else {
                result[key] = obj[key];
            }
        }
    });
    return result;
}

export function concatRecords<T>(records: Array<Record<string,T>>): Record<string,T> {
    const result: Record<string,T> = {}
    records.forEach(obj => {
        for (const key in obj) {
            if (result.hasOwnProperty(key)) {
                const orig = JSON.stringify(result[key]);
                const next = JSON.stringify(obj[key]);
                if (orig != next) {
                    throw Error(`Conflicting definitions found of key ${key}.`)
                }
            } else {
                result[key] = obj[key];
            }
        }
    });
    return result;
}

//#region Mutability
/**
 * Mutability of properties
 * 
 * Properties in Swagger are annotated with mutability in two ways.
 * Swagger itself defines a `readOnly` property, and Microsoft Azure
 * defines an extension `x-ms-mutability` that takes an array of
 * one or more of the strings `"create"`, `"write"`, and `"read"`.
 * We represent these as `Set<Mutability>`.
 * 
 * If `x-ms-mutability` is omitted, it means read, create, and update,
 * and we will keep that semantics.
 * 
 * The ARM contract requires that all properties be readable unless
 * they are secrets, and that secrets must not be readable. We will
 * assume that any mutability without read defines a secret.
 */

export enum Mutability { Create = "create", Read = "read", Write = "write" }

/**
 * We define some common mutabilities, including both possibilities for
 * secrets: immutable, that can only be set on creation; and mutable, that
 * can be updated after creation.
 */
export const ImmutableSecret = new Set([Mutability.Create]);
export const MutableSecret = new Set([Mutability.Create, Mutability.Write]);

export const ReadOnly = new Set([Mutability.Read]);
export const Immutable = new Set([Mutability.Create, Mutability.Read]);

export function serializeMutability(mt: Set<Mutability>|undefined) {
    if (!mt) {
        return {};
    }
    const target: Record<string,unknown> = {};
    target["x-ms-mutability"] = Array.from(mt).sort();
    if (mt == ReadOnly) {
        target.readOnly = true;
    }
    if (mt == ImmutableSecret || mt == MutableSecret) {
        target["x-ms-secret"] = true;
    }
    return target;
}
//#endregion

//#region API versions
/**
 * API versions
 * 
 * Each resource type, method on a resource, and properties of
 * resources or method response bodies has two API versions associated
 * with it: `previewVersion` and `gaVersion`. They are represented in
 * the Swagger as strings like `"2020-08-03"` for GA versions and
 * `"2020-08-03-preview"` for preview versions. We represent the versions
 * as a 3-tuple of numbers.
 */

export type Version = [number, number, number];

/**
 * Any versioned thing (resource, method, property) will be represented
 * as an object implementing the `Versioned` interface.
 */

export interface Versioned {
    previewVersion?: Version,
    gaVersion?: Version
}

/**
 * When we generate Swagger, we specify the target API version we
 * are generating it for. Any resource or property that has a version
 * after that date is skipped. A preview target version uses all
 * resources and properties with preview or GA version before it.
 * A GA target version only uses properties with a GA version before it.
 */
export enum VersionKind { Preview, GA }
export type TargetVersion = [Version, VersionKind];

export function inVersion(it: Versioned, targetVersion: TargetVersion): boolean {
    const [version, kind] = targetVersion;
    if (kind == VersionKind.Preview) {
        return (it.previewVersion != undefined && it.previewVersion <= version)
            || (it.gaVersion != undefined && it.gaVersion <= version);
    } else {
        return it.gaVersion != undefined && it.gaVersion <= version;
    }
}

/**
 * When we generate Swagger files, we have to produce the proper, 0-padded
 * strings from our `Version` values.
 */
export function serializeVersion(version: TargetVersion): string {
    const [[year,month,day], kind] = version;
    const pad = (n: number) => n < 10 ? "0" + n : n.toString();
    let versionString = `${year}-${pad(month)}-${pad(day)}`
    if (kind == VersionKind.Preview) {
        versionString += "-preview";
    }
    return versionString;
}
//#endregion

//#region Definitions
/**
 * The third part of a Swagger file is its definitions. These given the
 * schemas of various structures accepted and returned by endpoints.
 * 
 * A definition always an object type. Its properties are either non-object
 * fields or a reference to another definition.
 */
export interface Definition {
    description: string,
    properties: Record<string, Property>
}

//#endregion


//#region Field types
/**
 * We specify the types of fields with (possibly nested) specifiers.
 * Simple types, like booleans or integers, are represented by constants
 * like BoolT and Int32T, which are themselves members of a discriminated
 * union.
 * 
 * The one special case is objects. Objects generally are supposed to have
 * their own entries in the definitions section of a Swagger file and be
 * referred to with a `"$ref"` entry where they are used. When we serialize
 * fields we have two things to serialize. We need to serialize the actual
 * type description with references to other definitions, and we need
 * to serialize any definitions that emerge from the type description.
 * 
 * Fields are versioned, so we pass TargetVersions into all methods that operate
 * on them, and return null if there would be nothing generated.
 */

interface RequiredField { required?: boolean }

interface BoolField { kind: "bool" }
interface StringField { kind: "string" }
interface Int32Field { kind: "int32" }
interface Int64Field { kind: "int64" }
interface FloatField { kind: "float" }
interface ArrayField { kind: "array", elementKind: FieldType }
interface EnumField { kind: "enum", typeName: string, values: Array<string> }
interface ObjectField { 
    kind: "object", 
    definitionName: string, 
    description: string,
    properties: Record<string, Property> 
}
interface XRefField { kind: "xref", target: string }

 export type FieldType = 
    | BoolField
    | StringField
    | Int32Field
    | Int64Field
    | FloatField
    | ArrayField
    | ObjectField
    | EnumField
    | XRefField

export const BoolT: BoolField = { kind: "bool" };
export const StringT: StringField = { kind: "string" };
export const Int32T: Int32Field = { kind: "int32" };
export const Int64T: Int64Field = { kind: "int64" };
export const FloatT: FloatField = { kind: "float" };
export function ArrayT(t: FieldType): ArrayField {
    return { kind: "array", elementKind: t } 
}
export function ObjectT(definitionName: string, description: string, properties: Record<string, Property>): ObjectField { 
    return { 
        kind: "object", 
        definitionName: definitionName, 
        description: description, 
        properties: properties 
    }; 
}
export function EnumT(typeName: string, vs: Array<string>): EnumField { 
    return { kind: "enum", typeName: typeName, values: vs };
}

interface Property extends Versioned {
    description: string;
    type: FieldType;
    mutability?: Set<Mutability>;
    required?: boolean;
}

export function serializeFieldType(ft: FieldType): Record<string,unknown> {
    const target: Record<string,unknown> = {};
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
                name: ft.typeName,
            };
            break;
        case "array":
            target.type = "array";
            target.items = serializeFieldType(ft.elementKind);
            break;
        case "xref":
            target["$ref"] = `#/definitions/${ft.target}`
            break;
        case "object":
            throw Error('Cannot serialize field type object.');
    }
    return target;
}

export function definitionsFromFieldType(
    ft: FieldType, targetVersion: TargetVersion
): Record<string,Definition> {
    if (ft.kind != 'object') {
        return {};
    }

    let definitions: Record<string, Definition> = {};

    const definition: Definition = {
        description: ft.description,
        properties: {}
    }

    for (const key in ft.properties) {
        const property = ft.properties[key];

        if (!inVersion(property, targetVersion)) {
            // This property isn't defined in this version,
            // so we won't be needing any definitions from it.
            continue;
        }

        if (property.type.kind != 'object') {
            // Add the property as-is to the definition
            definition.properties[key] = property;
        } else {
            // Replace the property with a reference,
            // and search for definitions recursively.
            definition.properties[key] = {
                description: property.description,
                type: { kind: "xref", target: property.type.definitionName }
            };
            if (property.gaVersion != undefined) {
                definition.properties[key].gaVersion = property.gaVersion;
            }
            if (property.previewVersion != undefined) {
                definition.properties[key].previewVersion = property.previewVersion;
            }

            definitions = concatRecords([
                definitions, 
                definitionsFromFieldType(property.type, targetVersion)
            ]);
        }
    }

    definitions[ft.definitionName] = definition;
    return definitions;
}

export function serializeDefinition(definition: Definition): Record<string,unknown> {
    var result = {
        description: definition.description,
        type: "object",
        properties: {},
        required: new Array<string>()
    };

    const properties: Record<string,unknown> = {};
    const requiredFields: Array<string> = [];

    for (const key in definition.properties) {
        const property = definition.properties[key];
        if (property.required) {
            requiredFields.push(key);
        }
        properties[key] = concatObjects([
            { description: property.description },
            serializeFieldType(property.type),
            serializeMutability(property.mutability)
        ]);
    }

    result.properties = properties;
    if (requiredFields.length > 0) {
        result.required = requiredFields;
    }
    
    return result;
}

//#endregion

// target.properties = {};
// {
//     const requiredProperties = [];
//     const properties: Record<string, unknown> = {}
//     for (const propertyName in ft.properties) {
//         const pr = ft.properties[propertyName];
//         const sp = serializeProperty(propertyName, targetVersion, pr);
//         if (sp != null) {
//             properties[propertyName] = sp;
//         }
//         if (pr?.required) {
//             requiredProperties.push(propertyName);
//         }
//     }
//     target.properties = properties;
//     if (requiredProperties.length > 0) {
//         target.required = requiredProperties;
//     }
// }


// export function serializeProperty(name: string, targetVersion: TargetVersion, p: Property): Record<string,unknown>|null {
//     if (name == null || name.length == 0) {
//         throw Error("name must be nonempty.");
//     }

//     if (!inVersion(targetVersion, p)) {
//         return null;
//     }

//     const r: Record<string, unknown> = {
//         description: p.description
//     };
    
//     // Mutability
//     const isReadable = p.mutability == undefined || p.mutability.has(Mutability.Read)
//     const isSecret = p.type.kind == "secret";
//     if (isSecret && isReadable) {
//         throw Error('Secret properties must not be readable.');
//     } else if (!isSecret && !isReadable) {
//         throw Error('All non-secret properties must be readable.');
//     } else if (p.mutability == ReadOnly) {
//         r['x-ms-mutability'] = ["read"];
//         r['readOnly'] = true;
//     } else if (p.mutability != undefined) {
//         r['x-ms-mutability'] = serializeMutability(p.mutability);
//     }

//     serializeFieldType(name, targetVersion, p.type, r);


//     return r;
// }

// export interface ParameterSegment { 
//     name: string,
//     minLength?: number,
//     maxLength?: number,
//     pattern?: string,
// }

// export type PathSuffix = Array<[string, ParameterSegment]>

// export function serializePathSuffix(ps: PathSuffix) {
//     return ps.map(v => {
//         const [type, param] = v;
//         return `${type}/{${param.name}}`;
//     }).join('/')
// }

// enum ResourceType { Tracked, Proxy }

// interface ResourceExample {
//     parameters: Array<string>,
//     properties: Record<string, unknown>
// }

// interface Resource extends Versioned {
//     path: PathSuffix;
//     resourceKind: ResourceType;
//     readableName: string;
//     examples: [ResourceExample];
//     properties: Record<string, Property>;
//     methods?: Record<string, Method>;
//     asyncMethods?: Record<string, Method>;
// }

// // Resources generate:
// // - paths, with get, put, patch, and delete methods, and post
// //   paths for any additional methods.
// // - parameters
// // - definitions


// interface SwaggerTarget {
//     paths: Record<string, unknown>;
//     parameters: Record<string, unknown>;
//     definitions: Record<string, unknown>;
// }

// export function resourceType(path: PathSuffix): string {
//     const segment = path[path.length-1][0];
//     return segment.charAt(0).toUpperCase() + segment.slice(1);
// }




// export function serializeResource(provider: string, resource: Resource, target: SwaggerTarget) {
//     const pathSuffix = serializePathSuffix(resource.path);
//     const basePath = `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/${provider}/${pathSuffix}`;
//     const rt = resourceType(resource.path);
//     const rtPath = resource.path.map(v => v[0]).join("_");

//     // const populateHeader = (method, obj) => {
//     //     switch method {
//     //         case 'get':
//     //             obj.operationId = `${rt}_Get`;
//     //             obj.description = `Get the properties of an existing ${resource.readableName}.`;
//     //             break;
//     //         case 'put':
//     //             break;
//     //         case 'patch':
//     //             break;
//     //         case 'delete':
//     //             break;
//     //     }        

//     //     const exampleObj: Record<string, unknown> = {}
//     //     exampleObj[`${rt}_${method}`] = {
//     //         "$ref": `./examples/${provider}_${rtPath}_${method}.json`
//     //     };
//     //     obj['x-ms-examples'] = exampleObj;

//     //     obj.parameters = [
//     //         {
//     //             "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter"
//     //         },
//     //         {
//     //             "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter"
//     //         },
//     //     ];
//     //     resource.path.forEach(segment => {
//     //         const paramName = segment[1];
//     //         obj.parameters.push({
//     //             "$ref": "#/parameters/paramName"
//     //         });
//     //     });
//     //     obj.parameters.push({
//     //         "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter"
//     //     });
//     // };

//     // const getObj = {};
//     // populateHeader('Get', getObj);

//     target.paths[basePath] = {
//         get: {},
//         put: {},
//         patch: {},
//         delete: {},
//     };

    


//     // Add path to generated examples

//     // Add paths for listing resources

//     // Add parameters from resource.path to target.parameters if they are not already there. If they are, make sure they match.

//     // Add models for object types and resource and listing resources

//     // TODO: Add synchronous methods
//     // TODO: Add asynchronous methods
// }




// interface Method extends Versioned {
//     description: string,
//     returnType: FieldType,
//     example: Record<string, unknown>,
// }

// interface Module extends Versioned {
//     name: string;
//     resourceProvider: string;
//     resources: Array<Resource>;
//     suppressions?: Record<string, string>;
// }



// function flatten(path: PathSuffix): string {
//     return path.map(
//         segmentPair => `${segmentPair[0]}/{${segmentPair[1]}}`
//     ).join("/")
// }

// function serializeModule(module: Module, targetVersion: TargetVersion): Record<string,unknown>|null {
//     if (!inVersion(targetVersion, module)) { // Fix with inVersion
//         return null; // Generating a version before this module was defined.
//     }
    
//     // This is fixed preamble.
//     const obj = {
//         "swagger": "2.0",
//         "info": {
//           "title": "Cosmos DB",
//           "description": "Azure Cosmos DB Database Service Resource Provider REST API",
//           "version": serializeVersion(targetVersion)
//         },
//         "host": "management.azure.com",
//         "schemes": [
//           "https"
//         ],
//         "consumes": [
//           "application/json"
//         ],
//         "produces": [
//           "application/json"
//         ],
//         "security": [
//           {
//             "azure_auth": [
//               "user_impersonation"
//             ]
//           }
//         ],
//         "securityDefinitions": {
//           "azure_auth": {
//             "type": "oauth2",
//             "authorizationUrl": "https://login.microsoftonline.com/common/oauth2/authorize",
//             "flow": "implicit",
//             "description": "Azure Active Directory OAuth2 Flow",
//             "scopes": {
//               "user_impersonation": "Impersonate your user account"
//             }
//           }
//         },
//         "paths": {},
//         "parameters": {},
//         "definitions": {}
//     };

//     module.resources.forEach(resource => {
//         const path = flatten(resource.path);
//         const rt = resourceType(resource.path);

//         // TODO: Insert parameters into obj.parameters and references to them in operationParameters
//         const operationParameters: Array<Record<string,unknown>> = [
//             {
//                 "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter"
//             },
//             {
//                 "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter"
//             },
//             {
//                 "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter"
//             }
//         ]
//         // TODO: Add apiVersion parameter

//         // TODO: Generate definition from parameters and insert into obj.definitions

//         const vs = {
//             put: {
//                 operationId: `${rt}_CreateOrUpdate`
//             },
//             get: {
//                 operationId: `${rt}_Get`
//             },
//             delete: {
//                 operationId: `${rt}_Update`,
//                 description: `Deletes an existing ${resource.readableName}`,
//                 "x-ms-long-running-operation": true,
//                 parameters: operationParameters,
//                 responses: {
//                     "202": {
//                         "description": `Deleting the ${resource.readableName} will complete asynchronously.`
//                     },
//                     "204": {
//                         "description": `The specified ${resource.readableName} does not exist.`
//                     }
//                 }
//             },
//             patch: {
//                 operationId: `${rt}_Update`,
//                 description: `Updates the properties of an existing ${resource.readableName}.`,
//                 "x-ms-long-running-operation": true,
//                 parameters: operationParameters.concat([
//                     {
//                         name: "updateParameters",
//                         in: "body",
//                         required: true,
//                         schema: {
//                             "$ref": "#/definitions/..."
//                         },
//                         description: `The parameters to provide for the current ${resource.readableName}.`
//                     }
//                 ]),
//                 reponses: {
//                     "200": {
//                         "description": `The updates to the ${resource.readableName} will complete asynchronously.`
//                     }
//                 }
//             }
//         }

//         //obj.paths[path] = vs

//         // TODO: Add generation of methods and async methods

//         // TODO: Add generation of example files
//     });

//     return obj;
// }
