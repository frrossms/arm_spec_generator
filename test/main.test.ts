import {
  assertEquals,
  assertThrows,
} from "https://Deno.land/std/testing/asserts.ts";

import {
  ArrayT,
  BoolT,
  // Utilities
  concatObjects,
  Definition,
  definitionsFromFieldType,
  EnumT,
  // Fields, Properties, Definitions
  FieldType,
  FloatT,
  Immutable,
  ImmutableSecret,
  Int32T,
  Int64T,
  inVersion,
  Method,
  // TODO: Test concatRecords

  // Mutability
  Mutability,
  MutableSecret,
  ObjectT,
  PathSuffix,
  ReadOnly,
  Resource,
  resourceDefinitionName,
  ResourceType,
  serializeDefinition,
  serializeFieldType,
  serializeHandler,
  serializeMutability,
  serializePathSuffix,
  serializeVersion,
  StringT,
  // Versions
  TargetVersion,
  Version,
  Versioned,
  VersionKind,
  // TODO: concatRecords

  // serializePathSuffix,
  // resourceType,
} from "../src/main.ts";

//#region Utility methods
Deno.test("concatObjects works", () => {
  const expected = { alpha: 42, beta: 36, gamma: [{ a: 12 }, { b: 32 }] };
  const found = concatObjects([
    { alpha: 42, beta: 36 },
    { gamma: [{ a: 12 }, { b: 32 }] },
  ]);
  assertEquals(expected, found);
});
//#endregion

//#region Mutability tests
[
  {
    expected: {},
    input: undefined,
  },
  {
    expected: {
      readOnly: true,
      "x-ms-mutability": ["read"],
    },
    input: ReadOnly,
  },
  {
    expected: {
      "x-ms-mutability": ["create", "read"],
    },
    input: Immutable,
  },
  {
    expected: {
      "x-ms-secret": true,
      "x-ms-mutability": ["create"],
    },
    input: ImmutableSecret,
  },
  {
    expected: {
      "x-ms-secret": true,
      "x-ms-mutability": ["create", "write"],
    },
    input: MutableSecret,
  },
  {
    expected: {
      "x-ms-mutability": ["create", "read", "write"],
    },
    input: new Set([Mutability.Create, Mutability.Write, Mutability.Read]),
  },
].forEach((datum) =>
  Deno.test(`serializeMutability(${JSON.stringify(Array.from(datum.input || []))})`, () => {
    const found = serializeMutability(datum.input);
    assertEquals(datum.expected, found);
  })
);
//#endregion

//#region Version tests
const VersionA: Version = [2021, 2, 10];
const VersionB: Version = [2021, 2, 11];
const VersionC: Version = [2021, 2, 12];

const inVersionTestData: Array<
  { expected: boolean; targetVersion: TargetVersion; versioned: Versioned }
> = [
  // GA target version
  {
    // gaVersion before targetVersion
    expected: true,
    targetVersion: [VersionB, VersionKind.GA],
    versioned: {
      previewVersion: VersionA,
      gaVersion: VersionA,
    },
  },
  {
    // gaVersion after target version
    expected: false,
    targetVersion: [VersionB, VersionKind.GA],
    versioned: {
      previewVersion: VersionA,
      gaVersion: VersionC,
    },
  },
  {
    // gaVersion = target version
    expected: true,
    targetVersion: [VersionB, VersionKind.GA],
    versioned: {
      previewVersion: VersionA,
      gaVersion: VersionB,
    },
  },
  {
    // gaVersion not set
    expected: false,
    targetVersion: [VersionB, VersionKind.GA],
    versioned: {
      previewVersion: VersionA,
    },
  },
  // Preview target version
  {
    // gaVersion before target version
    expected: true,
    targetVersion: [VersionB, VersionKind.Preview],
    versioned: {
      gaVersion: VersionA,
    },
  },
  {
    // gaVersion after target version, previewVersion before targetVersion
    expected: true,
    targetVersion: [VersionB, VersionKind.Preview],
    versioned: {
      previewVersion: VersionA,
      gaVersion: VersionC,
    },
  },
  {
    // previewVersion before targetVersion, no gaVersion
    expected: true,
    targetVersion: [VersionB, VersionKind.Preview],
    versioned: {
      previewVersion: VersionA,
    },
  },
  {
    // previewVersion after targetVersion, no gaVersion
    expected: false,
    targetVersion: [VersionB, VersionKind.Preview],
    versioned: {
      previewVersion: VersionC,
    },
  },
  {
    // no version
    expected: false,
    targetVersion: [VersionB, VersionKind.Preview],
    versioned: {},
  },
  {
    // Deprecated in preview, before removal date
    expected: true,
    targetVersion: [[2021,2,1], VersionKind.Preview],
    versioned: {
      previewVersion: [2020,12,1],
      deprecatedOn: [2021,1,1]
    }
  },
  {
    // Deprecated in preview, after removal date
    expected: false,
    targetVersion: [[2021,10,1], VersionKind.Preview],
    versioned: {
      previewVersion: [2020,12,1],
      deprecatedOn: [2021,1,1]
    }
  },
  {
    // Deprecated in GA, preview version before removal date
    expected: true,
    targetVersion: [[2021,10,1], VersionKind.Preview],
    versioned: {
      previewVersion: [2020,12,1],
      gaVersion: [2020,12,2],
      deprecatedOn: [2021,1,1]
    }
  },
  {
    // Deprecated in GA, GA version after removal date
    expected: false,
    targetVersion: [[2026,10,1], VersionKind.Preview],
    versioned: {
      previewVersion: [2020,12,1],
      gaVersion: [2020,12,2],
      deprecatedOn: [2021,1,1]
    }
  }
];

inVersionTestData.forEach((datum) =>
  Deno.test(
    `inVersion(${JSON.stringify(datum.targetVersion)}, ${
      JSON.stringify(datum.versioned)
    })`,
    () => {
      assertEquals(
        datum.expected,
        inVersion(datum.versioned, datum.targetVersion),
      );
    },
  )
);

Deno.test("serializeVersion", () => {
  assertEquals("2021-01-03", serializeVersion([[2021, 1, 3], VersionKind.GA]));
  assertEquals(
    "2021-01-03-preview",
    serializeVersion([[2021, 1, 3], VersionKind.Preview]),
  );
  assertEquals(
    "2021-12-25",
    serializeVersion([[2021, 12, 25], VersionKind.GA]),
  );
});
//#endregion

//#region serializeFieldType
const serializeFieldTypeData: Array<
  { expected: Record<string, unknown>; input: FieldType }
> = [
  {
    expected: { type: "string" },
    input: StringT,
  },
  {
    expected: { type: "boolean" },
    input: BoolT,
  },
  {
    expected: { type: "integer", format: "int32" },
    input: Int32T,
  },
  {
    expected: { type: "integer", format: "int64" },
    input: Int64T,
  },
  {
    expected: { type: "number", format: "double" },
    input: FloatT,
  },
  {
    expected: {
      type: "string",
      enum: ["Alpha", "Beta", "Gamma"],
      "x-ms-enum": {
        modelAsString: true,
        name: "SomethingLong",
      },
    },
    input: EnumT("SomethingLong", ["Alpha", "Beta", "Gamma"]),
  },
  {
    expected: {
      type: "array",
      items: {
        type: "number",
        format: "double",
      },
    },
    input: ArrayT(FloatT),
  },
  {
    expected: {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    input: ArrayT(ArrayT(StringT)),
  },
  {
    expected: {
      "$ref": "#/definitions/MyDefinition",
    },
    input: { kind: "xref", target: "MyDefinition" },
  },
  {
    expected: {
      "type": "array",
      "items": {
        "$ref": "#/definitions/SomeType",
      },
    },
    input: ArrayT({ kind: "xref", target: "SomeType" }),
  },
];
serializeFieldTypeData.forEach((datum) =>
  Deno.test(
    `serializeFieldType(${JSON.stringify(datum.input)})`,
    () => {
      assertEquals(
        datum.expected,
        serializeFieldType(datum.input),
      );
    },
  )
);
//#endregion

//#region definitionsFromFieldType
const definitionsFromFieldTypeData: Array<
  {
    expected: Record<string, Definition>;
    ft: FieldType;
    targetVersion: TargetVersion;
  }
> = [
  {
    // No definitions from basic types
    expected: {},
    ft: StringT,
    targetVersion: [VersionB, VersionKind.GA],
  },
  {
    // Simple properties, properly versioned
    expected: {
      "Definition1": {
        description: "Hello",
        properties: {
          "boris": {
            description: "Boris property",
            type: StringT,
            gaVersion: VersionA,
          },
          "hilda": {
            description: "Hilda property",
            type: ArrayT(Int32T),
            gaVersion: VersionA,
          },
        },
      },
    },
    ft: ObjectT(
      "Definition1",
      "Hello",
      {
        "boris": {
          description: "Boris property",
          type: StringT,
          gaVersion: VersionA,
        },
        "hilda": {
          description: "Hilda property",
          type: ArrayT(Int32T),
          gaVersion: VersionA,
        },
        "meep": {
          description: "Meep property",
          type: BoolT,
          gaVersion: VersionC,
        },
      },
    ),
    targetVersion: [VersionB, VersionKind.GA],
  },
  {
    expected: {
      "Definition1": {
        description: "Hello",
        properties: {
          "boris": {
            description: "Boris property",
            type: { kind: "xref", target: "Definition2" },
            gaVersion: VersionA,
          },
          "hortense": {
            description: "Hortense property",
            type: { kind: "xref", target: "Definition2" },
            gaVersion: VersionA,
          },
        },
      },
      "Definition2": {
        description: "Goodbye",
        properties: {
          "meep": {
            description: "Meep",
            type: StringT,
            gaVersion: VersionA,
          },
        },
      },
    },
    ft: ObjectT(
      "Definition1",
      "Hello",
      {
        "boris": {
          description: "Boris property",
          type: ObjectT(
            "Definition2",
            "Goodbye",
            {
              meep: {
                description: "Meep",
                type: StringT,
                gaVersion: VersionA,
              },
            },
          ),
          gaVersion: VersionA,
        },
        "hilda": {
          description: "Hilda property",
          type: ObjectT(
            "Definition2",
            "Goodbye",
            {
              meep: {
                description: "Meep",
                type: StringT,
                gaVersion: VersionA,
              },
            },
          ),
          gaVersion: VersionC,
        },
        "hortense": {
          description: "Hortense property",
          type: ObjectT(
            "Definition2",
            "Goodbye",
            {
              meep: {
                description: "Meep",
                type: StringT,
                gaVersion: VersionA,
              },
            },
          ),
          gaVersion: VersionA,
        },
      },
    ),
    targetVersion: [VersionB, VersionKind.GA],
  },
];
definitionsFromFieldTypeData.forEach((datum) =>
  Deno.test(
    `definitionsFromFieldType(${JSON.stringify(datum.ft)}, ${
      JSON.stringify(datum.targetVersion)
    })`,
    () => {
      assertEquals(
        datum.expected,
        definitionsFromFieldType(datum.ft, datum.targetVersion),
      );
    },
  )
);

const serializeDefinitionTestData: Array<
  { expected: Record<string, unknown>; input: Definition }
> = [
  {
    expected: {
      description: "Hello",
      type: "object",
      properties: {},
      required: [],
    },
    input: {
      description: "Hello",
      properties: {},
    },
  },
  {
    expected: {
      description: "Goodbye",
      type: "object",
      required: ["alpha", "gamma"],
      properties: {
        alpha: {
          description: "Alpha",
          type: "string",
          readOnly: true,
          "x-ms-mutability": ["read"],
        },
        beta: {
          description: "Beta",
          type: "string",
          "x-ms-secret": true,
          "x-ms-mutability": ["create"],
        },
        gamma: {
          description: "Gamma",
          type: "array",
          items: {
            type: "integer",
            format: "int32",
          },
        },
        delta: {
          description: "Delta",
          "$ref": "#/definitions/Definition2",
        },
      },
    },
    input: {
      description: "Goodbye",
      properties: {
        alpha: {
          description: "Alpha",
          type: StringT,
          mutability: ReadOnly,
          required: true,
        },
        beta: {
          description: "Beta",
          type: StringT,
          mutability: ImmutableSecret,
        },
        gamma: {
          description: "Gamma",
          type: ArrayT(Int32T),
          required: true,
        },
        delta: {
          description: "Delta",
          type: { kind: "xref", target: "Definition2" },
        },
      },
    },
  },
];
serializeDefinitionTestData.forEach((datum) =>
  Deno.test(
    `serializeDefinition(${JSON.stringify(datum.input)})`,
    () => {
      assertEquals(
        datum.expected,
        serializeDefinition(datum.input),
      );
    },
  )
);

//#endregion

//#region PathSuffixes
const resourceDefinitionNameTestData: Array<
  { expected: string; input: PathSuffix }
> = [
  {
    expected: "AccountsResource",
    input: [["accounts", { name: "accountName" }]],
  },
  {
    expected: "CollectionsResource",
    input: [["accounts", { name: "accountName" }], ["collections", {
      name: "collectionName",
    }]],
  },
];
resourceDefinitionNameTestData.forEach((datum) =>
  Deno.test(
    `resourceDefinitionName(${JSON.stringify(datum.input)})`,
    () => {
      assertEquals(
        datum.expected,
        resourceDefinitionName(datum.input),
      );
    },
  )
);

const serializePathSuffixTestData: Array<
  { expected: string; input: PathSuffix }
> = [
  {
    expected: "accounts/{accountName}",
    input: [["accounts", { name: "accountName" }]],
  },
  {
    expected: "accounts/{accountName}/collections/{collectionName}",
    input: [["accounts", { name: "accountName" }], ["collections", {
      name: "collectionName",
    }]],
  },
];
serializePathSuffixTestData.forEach((datum) =>
  Deno.test(
    `serializePathSuffix(${JSON.stringify(datum.input)})`,
    () => {
      assertEquals(
        datum.expected,
        serializePathSuffix(datum.input),
      );
    },
  )
);
//#endregion

//#region serializeHandler
const resource: Resource = {
  path: [["accounts", { name: "accountName" }], ["collections", {
    name: "collections",
  }]],
  resourceKind: ResourceType.Tracked,
  readableName: "collection",
  readablePluralName: "collections",
  properties: {
    "alpha": {
      description: "Alpha field",
      type: StringT,
    },
    "sercretBeta": {
      description: "Beta field",
      type: BoolT,
      mutability: ImmutableSecret,
    },
  },
};

const serializeHandlerTestData: Array<
  { expected: Record<string, unknown>; resource: Resource; method: Method }
> = [
  {
    expected: {
      operationId: "Collections_Get",
      description: "Get the properties of this collection.",
      parameters: [
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter",
        },
        {
          "$ref": "#/parameters/accountNameResource",
        },
        {
          "$ref": "#/parameters/collectionsResource",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter",
        },
      ],
      responses: {
        "200": {
          description:
            "The properties of this collection were retrieved successfully.",
          schema: {
            "$ref": "#/definitions/CollectionsResource",
          },
        },
      },
    },
    resource: resource,
    method: Method.Get,
  },
  {
    resource: resource,
    method: Method.Delete,
    expected: {
      operationId: "Collections_Delete",
      description: "Delete this collection.",
      "x-ms-long-running-operation": true,
      parameters: [
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter",
        },
        {
          "$ref": "#/parameters/accountNameResource",
        },
        {
          "$ref": "#/parameters/collectionsResource",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter",
        },
      ],
      responses: {
        "202": {
          description:
            "Accepted. This collection will be deleted asynchronously.",
        },
        "204": {
          description: "No such collection to delete.",
        },
      },
    },
  },
  {
    resource: resource,
    method: Method.Put,
    expected: {
      operationId: "Collections_CreateUpdate",
      description:
        "Create or update this collection. If updating, all properties must be provided. Use PATCH to update with only some properties.",
      "x-ms-long-running-operation": true,
      parameters: [
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter",
        },
        {
          "$ref": "#/parameters/accountNameResource",
        },
        {
          "$ref": "#/parameters/collectionsResource",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter",
        },
        {
          name: "body",
          in: "body",
          required: true,
          schema: {
            "$ref": "#/definitions/CollectionsResource",
          },
          description: "The properties to set on this collection.",
        },
      ],
      responses: {
        "200": {
          description:
            "This collection is being updated. Poll for provisioningState=Succeeded, Failed, or Cancelled for completion.",
          schema: {
            "$ref": "#/definitions/CollectionsResource",
          },
        },
        "201": {
          description:
            "This collection is being created. Poll for provisioningState=Succeeded, Failed, or Cancelled for completion.",
          schema: {
            "$ref": "#/definitions/CollectionsResource",
          },
        },
      },
    },
  },
  {
    resource: resource,
    method: Method.Patch,
    expected: {
      operationId: "Collections_Update",
      description: "Update properties of this collection. Any properties not provided will not be altered.",
      "x-ms-long-running-operation": true,
      parameters: [
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/SubscriptionIdParameter",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ResourceGroupNameParameter",
        },
        {
          "$ref": "#/parameters/accountNameResource",
        },
        {
          "$ref": "#/parameters/collectionsResource",
        },
        {
          "$ref":
            "../../../../../common-types/resource-management/v2/types.json#/parameters/ApiVersionParameter",
        },
        {
          name: "body",
          in: "body",
          required: true,
          schema: {
            "$ref": "#/definitions/CollectionsResource",
          },
          description: "The properties to set on this collection.",
        },
      ],
      responses: {
        "200": {
          description:
            "Completed synchronously. This will only happen if the values provided match those already present in this collection.",
          schema: {
            "$ref": "#/definitions/CollectionsResource",
          },
        },
        "202": {
          description:
            "This collection is being updated asynchronously. Poll the provided operation for completion.",
          schema: {
            "$ref": "#/definitions/CollectionsResource",
          },
        },
      },
    },
  },
];
serializeHandlerTestData.forEach((datum) =>
  Deno.test(
    `serializeHandler(${JSON.stringify(datum.resource)}, ${
      JSON.stringify(datum.method)
    })`,
    () => {
      assertEquals(
        datum.expected,
        serializeHandler(datum.resource, datum.method),
      );
    },
  )
);
//#endregion





// const d2: Array<[Record<string, unknown>|null, Property]> = [
//     [
//         null,
//         {
//             description: "Not in version yet",
//             type: StringT,
//             previewVersion: [2021,6,6]
//         }
//     ],
//     [
//         {
//             description: "Simple string",
//             type: "string"
//         },
//         {
//             description: "Simple string",
//             type: StringT,
//             previewVersion: [2021,1,3]
//         }
//     ],
//     [
//         {
//             description: "Create only string",
//             type: "string",
//             "x-ms-mutability": ["create", "read"]
//         },
//         {
//             description: "Create only string",
//             type: StringT,
//             mutability: Immutable,
//             previewVersion: [2021,1,3],
//         }
//     ],
//     [
//         {
//             description: "Read-only boolean",
//             type: "boolean",
//             "x-ms-mutability": ["read"],
//             readOnly: true
//         },
//         {
//             description: "Read-only boolean",
//             type: BoolT,
//             mutability: ReadOnly,
//             previewVersion: [2021,1,3],
//         }
//     ],
//     [
//         {
//             description: "Int32 field",
//             type: "integer",
//             format: "int32"
//         },
//         {
//             description: "Int32 field",
//             type: Int32T,
//             previewVersion: [2021,1,3]
//         }
//     ],
//     [
//         {
//             description: "Int64 field",
//             type: "integer",
//             format: "int64"
//         },
//         {
//             description: "Int64 field",
//             type: Int64T,
//             previewVersion: [2021,1,3]
//         }
//     ],
//     [
//         {
//             description: "Float field",
//             type: "number",
//             format: "double"
//         },
//         {
//             description: "Float field",
//             type: FloatT,
//             previewVersion: [2021,1,3]
//         }
//     ],
//     [
//         {
//             description: "Enum field",
//             type: "string",
//             enum: [
//                 "Alpha",
//                 "Beta",
//                 "Gamma",
//             ],
//             "x-ms-enum": {
//                 modelAsString: true,
//                 name: "MyPropertyEnum",
//             }
//         },
//         {
//             description: "Enum field",
//             type: EnumT(["Alpha", "Beta", "Gamma"]),
//             previewVersion: [2021,1,3],
//         }
//     ],
//     [
//         {
//             description: "Secret string",
//             type: "string",
//             "x-ms-secret": true,
//             "x-ms-mutability": ["create", "write"]
//         },
//         {
//             description: "Secret string",
//             type: SecretT(StringT),
//             mutability: WriteOnly,
//             previewVersion: [2021,1,3],
//         }
//     ],
//     [
//         {
//             description: "Array of int32",
//             type: "array",
//             items: {
//                 type: "integer",
//                 format: "int32"
//             }
//         },
//         {
//             description: "Array of int32",
//             type: ArrayT(Int32T),
//             previewVersion: [2021,1,3],
//         }
//     ],
//     [
//         {
//             description: "Object with no required fields",
//             type: "object",
//             properties: {
//                 "field1": {
//                     description: "Field1",
//                     type: "string",
//                     "x-ms-mutability": ["create", "read"]
//                 },
//                 "field2": {
//                     description: "Field2",
//                     type: "array",
//                     items: {
//                         type: "string"
//                     },
//                     readOnly: true,
//                     "x-ms-mutability": ["read"]
//                 }
//             },
//             required: ["field2"]
//         },
//         {
//             description: "Object with no required fields",
//             previewVersion: [2021,1,3],
//             type: ObjectT({
//                 field1: {
//                     description: "Field1",
//                     type: StringT,
//                     mutability: Immutable,
//                     previewVersion: [2021,1,3],
//                 },
//                 field2: {
//                     description: "Field2",
//                     type: ArrayT(StringT),
//                     mutability: ReadOnly,
//                     previewVersion: [2021,1,3],
//                     required: true,
//                 }
//             })
//         }
//     ],
//     [
//         {
//             description: "Object with no required fields",
//             type: "object",
//             properties: {
//                 "field1": {
//                     description: "Field1",
//                     type: "string",
//                     "x-ms-mutability": ["create", "read"]
//                 },
//             }
//         },
//         {
//             description: "Object with no required fields",
//             previewVersion: [2021,1,3],
//             type: ObjectT({
//                 field1: {
//                     description: "Field1",
//                     type: StringT,
//                     mutability: Immutable,
//                     previewVersion: [2021,1,3],
//                 },
//                 field2: {
//                     description: "Field2",
//                     type: ArrayT(StringT),
//                     mutability: ReadOnly,
//                     previewVersion: [2021,1,5],
//                 }
//             })
//         }
//     ],
//     [
//         {
//             description: "Certificates",
//             type: "array",
//             items: {
//                 type: "object",
//                 properties: {
//                     "pem": {
//                         type: "string",
//                         description: "PEM of certificate"
//                     }
//                 }
//             }
//         },
//         {
//             description: "Certificates",
//             type: ArrayT(ObjectT({
//                 pem: {
//                     type: StringT,
//                     description: "PEM of certificate",
//                     previewVersion: [2021,1,3],
//                 }
//             })),
//             previewVersion: [2021,1,3]
//         }
//     ]
// ];
// for (const i in d2) {
//     const [expected, input] = d2[i];

//     Deno.test("serializeProperty(" + JSON.stringify(input) + ")", () =>
//         assertEquals(expected, serializeProperty("myProperty", [[2021,1,3], VersionKind.Preview], input))
//     )
// }

// Deno.test("No nested SecretT", () => {
//     assertThrows(() => serializeProperty("myProperty", v, {
//         description: "A description",
//         type: SecretT(SecretT(StringT)),
//         mutability: WriteOnly,
//         previewVersion: [2021,1,3]
//     }))
// });

// Deno.test('serializePathSuffix', () => {
//     assertEquals("", serializePathSuffix([]));
//     assertEquals(
//         "databaseAccounts/{accountName}",
//         serializePathSuffix([["databaseAccounts", {name: "accountName"}]]),
//     );
//     assertEquals(
//         "databaseAccounts/{accountName}/collections/{collectionName}",
//         serializePathSuffix([
//             ["databaseAccounts", {name: "accountName"}],
//             ["collections", {name: "collectionName", minLength: 1, maxLength: 50}]
//         ])
//     );
// });

// Deno.test('resourceType', () => {
//     assertEquals("DatabaseAccounts", resourceType([["databaseAccounts", {name: "accountName"}]]));
//     assertEquals(
//         "Collections",
//         resourceType([
//             ["databaseAccounts", {name: "accountName"}],
//             ["collections", {name: "collectionName", minLength: 1, maxLength: 50}]
//         ])
//     )
// });

// // // ------------------------

// // const v20210301 : Version = [2021, 3, 1]

// // const dbAccount : Resource = {
// //     path: [["databaseAccounts", { name: "accountName", minLength: 3, maxLength: 50 }]],
// //     readableName: "CosmosDB database account",
// //     resourceKind: ResourceType.Tracked,
// //     previewVersion: v20210301,
// //     properties: {
// //         delegatedManagementSubnetId: {
// //             description: "Subnet to attach NICs to",
// //             type: StringT,
// //             mutability: Immutable,
// //             previewVersion: v20210301,
// //             gaVersion: v20210502
// //         },
// //         externalCertificates: {
// //             description: "TLS certificates to authenticate gossip",
// //             previewVersion: v20210301,
// //             type: ArrayT(ObjectT({
// //                 pem: {
// //                     description: "PEM formatted public key",
// //                     type: StringT,
// //                     previewVersion: v20210301
// //                 }
// //             }))
// //         },
// //         initialAdminPassword: {
// //             description: "Password to log in initially",
// //             type: SecretT(StringT),
// //             previewVersion: v20210301,
// //             mutability: CreateOnly
// //         },
// //         myNewField: {
                  // description: ...
                  // type: StringT,
                  // gaVersion: v20210512,
                  // deprecatedVersion: v20210512,
                  // aliases: ['myRenamedField']
// }
// //         myRenamedField: {
             //     gaVersion: v20240512
//}
// //     },
// //     examples: [
// //         {
// //             parameters: ["my-database-account"],
// //             properties: {
// //                 delegatedManagementSubnetId: "/subscriptions/.../subnet",
// //                 externalCertificates: [
// //                     {"pem": "sadfSDFSDFAFD"}
// //                 ],
// //                 initialAdminPassword: "mypassword"
// //             },
// //         }
// //     ],
// //     methods: {
// //         fetchNodeStatus: {
// //             description: "Get the status of all nodes",
// //             previewVersion: v20210301,
// //             returnType: ObjectT({
// //                 value: {
// //                     previewVersion: v20210301,
// //                     description: "Node statuses",
// //                     type: Object({
// //                         dc: {
// //                             description: "Data center the node is in",
// //                             type: StringT,
// //                             previewVersion: v20210301
// //                         }
// //                     })
// //                 }
// //             }),
// //             example: {
// //                 value: [
// //                     {dc: "dc1"}
// //                 ]
// //             }
// //         }
// //     }
// // }

// // const cosmosDb : Module = {
// //     name: "cosmos-db",
// //     previewVersion: v20210301,
// //     resourceProvider: "Microsoft.DocumentDB",
// //     resources: [dbAccount]
// // }

// // Deno.test("test1", () => {
// //     //assertEquals(3, add(2, 1));
// // });
