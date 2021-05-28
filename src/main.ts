import { ensureDirSync } from "https://deno.land/std@0.97.0/fs/ensure_dir.ts";


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

export function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
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
    gaVersion?: Version,
    deprecatedOn?: Version
}

/**
 * When we generate Swagger, we specify the target API version we
 * are generating it for. Any resource or property that has a version
 * after that date is skipped. A preview target version uses all
 * resources and properties with preview or GA version before it.
 * A GA target version only uses properties with a GA version before it.
 *
 * If there is a deprecatedOn date set, then if the Versioned object is
 * only in preview, it will cease to be generated six months after the
 * deprecatedOn date. If the versioned object is in GA, then it cease to
 * be generated three years after the deprecatedOn date.
 */
export enum VersionKind { Preview, GA }
export type TargetVersion = [Version, VersionKind];


export function removalDate(it: Versioned): Version|null {
    if (it.deprecatedOn == undefined) {
        return null;
    }

    const [year, month, day] = it.deprecatedOn;
    if (it.gaVersion != undefined) {
        return [year+3, month, day];
    } else if (it.previewVersion != undefined) {
        if (month > 5) {
            return [year+1, month-5, day];
        } else {
            return [year, month+6, day];
        }
    } else {
        return null;
    }
}

function atMost(a: Version, b: Version) {
    const [yearA, monthA, dayA] = a;
    const [yearB, monthB, dayB] = b;
    return (yearA < yearB) ||
        (yearA == yearB && monthA < monthB) ||
        (yearA == yearB && monthA == monthB && dayA <= dayB);
}

export function inVersion(it: Versioned, targetVersion: TargetVersion): boolean {
    const [version, kind] = targetVersion;

    // First check if we are past when a deprecated field
    // should be removed.
    const rd = removalDate(it);
    if (rd !== null && atMost(rd, version)) {
        return false;
    }

    if (kind == VersionKind.Preview) {
        return (it.previewVersion != undefined && atMost(it.previewVersion, version))
                || (it.gaVersion != undefined && atMost(it.gaVersion, version));
    } else {
        return it.gaVersion != undefined && atMost(it.gaVersion, version);
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
export function XRefT(target: string): XRefField { return { kind: "xref", target: target }; }

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

//#region Path suffixes
export interface ParameterSegment {
    name: string,
    minLength?: number,
    maxLength?: number,
    pattern?: string,
}

export type PathSuffix = Array<[string, ParameterSegment]>

export function serializePathSuffix(ps: PathSuffix) {
    return ps.map(v => {
        const [type, param] = v;
        return `${type}/{${param.name}}`;
    }).join('/')
}

export function resourceDefinitionName(ps: PathSuffix, suffix: string = 'Resource') {
    if (ps.length == 0) {
        throw Error('Cannot get resourceTypeName of empty PathSuffix.');
    }
    return capitalize(ps[ps.length-1][0]) + suffix;
}
//#endregion

//#region Resources
export enum ResourceType { Tracked, Proxy, ReadOnlyProxy }

// interface ResourceExample {
//     parameters: Array<string>,
//     properties: Record<string, unknown>
// }

export interface Resource extends Versioned {
    path: PathSuffix;
    resourceType: ResourceType;
    readableName: string,
    readablePluralName: string;
    //examples: [ResourceExample];
    properties: Record<string, Property>;
    //methods?: Record<string, Method>;
    //asyncMethods?: Record<string, Method>;
}

export enum Method { Get = "get", Put = "put", Patch = "patch", Delete = "delete" };

export function serializeHandler(resource: Resource, method: Method): Record<string, unknown> {
    var opKind: string;
    switch (method) {
        case Method.Get:
            opKind = "Get";
            break;
        case Method.Put:
            opKind = "CreateUpdate";
            break;
        case Method.Patch:
            opKind = "Update";
            break;
        case Method.Delete:
            opKind = "Delete";
            break;
    }

    const target: Record<string, unknown> = {
        operationId: `${capitalize(resource.readablePluralName)}_${opKind}`,
    };

    const defn = `#/definitions/${resourceDefinitionName(resource.path)}`;

    const parameters: Array<Record<string, unknown>> = [
        {
            "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter"
        },
        {
            "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter"
        },
    ];
    resource.path.forEach(segment => {
        const parameterName = segment[1].name;
        parameters.push({"$ref": `#/parameters/${parameterName}`});
    });
    parameters.push({
        "$ref": "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter"
    })
    if (method == Method.Put || method == Method.Patch) {
        parameters.push({
            name: "body",
            in: "body",
            required: true,
            schema: {
                "$ref": defn
            },
            description: `The properties to set on this ${resource.readableName}.`
        });
    }
    target.parameters = parameters;

    switch (method) {
        case Method.Get:
            target.description = `Get the properties of this ${resource.readableName}.`;
            break;
        case Method.Put:
            target.description = `Create or update this ${resource.readableName}. If updating, all properties must be provided. Use PATCH to update with only some properties.`;
            break;
        case Method.Delete:
            target.description = `Delete this ${resource.readableName}.`;
            break;
        case Method.Patch:
            target.description = `Update properties of this ${resource.readableName}. Any properties not provided will not be altered.`;
            break;
    }

    if (method != Method.Get) {
        target["x-ms-long-running-operation"] = true;
    }

    const responses: Record<string,unknown> = {};
    switch (method) {
        case Method.Get:
            responses['200'] = {
                description: `The properties of this ${resource.readableName} were retrieved successfully.`,
                schema: {
                    "$ref": defn
                }
            }
            break;
        case Method.Delete:
            responses["202"] = {
                description: `Accepted. This ${resource.readableName} will be deleted asynchronously.`
            };
            responses["204"] = {
                description: `No such ${resource.readableName} to delete.`
            }
            break;
        case Method.Put:
            responses["200"] = {
                description: `This ${resource.readableName} is being updated. Poll for provisioningState=Succeeded, Failed, or Cancelled for completion.`,
                schema: {
                    "$ref": defn
                }
            };
            responses["201"] = {
                description: `This ${resource.readableName} is being created. Poll for provisioningState=Succeeded, Failed, or Cancelled for completion.`,
                schema: {
                    "$ref": defn
                }
            }
            break;
        case Method.Patch:
            responses["200"] = {
                description: `Completed synchronously. This will only happen if the values provided match those already present in this ${resource.readableName}.`,
                schema: {
                  "$ref": defn
                }
            };
            responses["202"] = {
                description: `This ${resource.readableName} is being updated asynchronously. Poll the provided operation for completion.`,
                schema: {
                    "$ref": defn
                }
            };
    }
    target.responses = responses;

    return target;
}
//#endregion

//#region Generating modules:
export function parametersFromResource(resource: Resource, targetVersion: TargetVersion): Record<string, unknown> {
    return {};
}

export function pathsFromResource(resource: Resource, namespace: string, targetVersion: TargetVersion): Record<string, unknown> {
    var paths: Record<string, unknown> = {};

    const resourcePath = `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/${namespace}/${serializePathSuffix(resource.path)}`
    paths[resourcePath] = {
        "get": serializeHandler(resource, Method.Get),
        "put": serializeHandler(resource, Method.Put),
        "patch": serializeHandler(resource, Method.Patch),
        "delete": serializeHandler(resource, Method.Delete)
    }
    // TODO: Add paths from methods and async methods.

    return paths;
}

const commonTrackedProperties: Record<string, Property> = {
    id: {
        type: StringT,
        description: "The unique resource identifier of the ARM resource.",
        mutability: ReadOnly
    },
    name: {
        type: StringT,
        description: "The name of the ARM resource.",
        mutability: Immutable

    },
    type: {
        type: StringT,
        description: "The type of Azure resource.",
        mutability: ReadOnly
    },
    location: {
        type: StringT,
        description: "The location this resource exists in.",
        mutability: Immutable
    }
    // TODO: Add tags. Need a new TagT type that serializes specially.
}

export function definitionsFromResource(resource: Resource, targetVersion: TargetVersion): Record<string, unknown> {
    var definitions: Record<string, unknown> = {};

    // TODO: Add "x-ms-azure-resource": true to resource in appropriate place.

    var properties = null;
    if (resource.resourceType == ResourceType.Tracked) {
        properties = commonTrackedProperties;
    } else {
        properties = {};
    }
    properties["properties"] = {
        type: XRefT(resourceDefinitionName(resource.path, 'Properties')),
        description: `Properties of a ${resource.readableName}.`
        // TODO: Add support for x-ms-client-flatten to XRefT.
    };

    definitions[resourceDefinitionName(resource.path)] = serializeDefinition({
       description: `A ${resource.readableName}.`,
       properties: properties
    });
    definitions[resourceDefinitionName(resource.path, 'Properties')] = serializeDefinition({
        description: `Properties of a ${resource.readableName}`,
        properties: resource.properties
    })
    // TODO: Add definitions from methods and async methods.

    return definitions;
}


// //#endregion

// //#region Serialize module
export interface Module {
    filename: string,
    title: string,
    description: string,
    namespace: string,
    resources: Array<Resource>
}

export function serializeModule(module: Module, targetVersion: TargetVersion): Record<string, unknown> {
    let resourcesInVersion = module.resources.filter(resource => inVersion(resource, targetVersion));
    var paths: Record<string, unknown> = concatRecords(
        resourcesInVersion.map(resource => pathsFromResource(resource, module.namespace, targetVersion))
    );
    var definitions: Record<string, unknown> = concatRecords(
        resourcesInVersion.map(resource => definitionsFromResource(resource, targetVersion))
    );

    return {
        "swagger": "2.0",
        "info": {
            "title": module.title,
            "description": module.description,
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
        "paths": paths,
        "parameters": {}, // TODO
        "definitions": definitions // TODO
    };
}

export function generateSwagger(module: Module, targetPath: string, versions: Array<TargetVersion>) {
    versions.forEach(version => {
        const subdir = version[1] == VersionKind.Preview ? "preview" : "stable";
        const dir = targetPath + "/" + subdir + "/" + serializeVersion(version);
        ensureDirSync(dir);
        Deno.writeTextFileSync(
            dir + "/" + module.filename,
            JSON.stringify(serializeModule(module, version), null, '    '));
    });
}

//#endregion

// TODO:
// Handler (get, put, patch, delete)

// Post methods
// - parametersFromPostMethod(PostMethod, TargetVersion)
// - definitionsFromPostMethod(PostMethod, TargetVersion)
// - pathsFromPostMethod(PostMethod, TargetVersion)
//
// Resource (contains post methods)
// - parametersFromResource(Resource, TargetVersion)
// - pathsFromResource(Resource, TargetVersion) (include listing the resource)
// - definitionsFromResource(Resource, TargetVersion)
//
// - serializeModule(provider: string, resources: Array<Resouce>, TargetVersion)
//
// Add examples
//
// Then work for readme.md
// - serializeProvider(provider: string, Array<Resource>, Array<TargetVersion>)
// Add suppression rules

// Probably will need:
// - alias for existing definitions so type names in SDKs don't break.
// - legacy endpoint
// - singleton extended status GETs

//#region Old

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
//#endregion