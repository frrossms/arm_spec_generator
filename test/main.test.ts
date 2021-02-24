import { assertEquals, assertThrows } from "https://Deno.land/std/testing/asserts.ts";
import {
    TargetVersion,
    Versioned,
    VersionKind,
    serializeVersion,
    inVersion,
    Mutability,
    serializeMutability,
    ReadOnly,
    CreateOnly,
    Immutable,
    WriteOnly,
    Property,
    serializeProperty,
    StringT,
    BoolT,
    Int32T,
    Int64T,
    FloatT,
    EnumT,
    SecretT,
    ArrayT,
    ObjectT,
} from "../src/main.ts";

Deno.test("serializeMutability", () => {
    assertEquals([], serializeMutability(new Set([])));
    assertEquals(["create", "read", "write"], serializeMutability(new Set([Mutability.Write, Mutability.Read, Mutability.Create])));
    assertEquals(["read"], serializeMutability(ReadOnly));
    assertEquals(["create"], serializeMutability(CreateOnly));
    assertEquals(["create", "read"], serializeMutability(Immutable));
})

const d1: Array<[boolean, TargetVersion, Versioned]> = [
    [
        true,
        [[2021,1,3],VersionKind.GA],
        {
            previewVersion: [2020,6,20],
            gaVersion: [2020,8,20],
        }
    ]
]

for (const i in d1) {
    const [expected, targetVersion, versioned] = d1[i];
    Deno.test(`inVersion(${JSON.stringify(targetVersion)}, ${JSON.stringify(versioned)})`, () => {
        assertEquals(expected, inVersion(targetVersion, versioned));
    });
}

Deno.test("serializeVersion", () => {
    assertEquals("2021-01-03", serializeVersion([[2021,1,3], VersionKind.GA]));
    assertEquals("2021-01-03-preview", serializeVersion([[2021,1,3], VersionKind.Preview]));
    assertEquals("2021-12-25", serializeVersion([[2021,12,25], VersionKind.GA]));
})

const v: TargetVersion = [[2022,1,1], VersionKind.Preview];

Deno.test("Non-secret properties must be readable", () => {
    assertThrows(() => serializeProperty("myProperty", v, {
        description: "Nothing",
        type: StringT,
        mutability: CreateOnly,
        previewVersion: [2021,1,3],
    }));
})

Deno.test("Secret fields must not be readable", () => {
    assertThrows(() => serializeProperty("myProperty", v, {
        description: "Nothing",
        type: SecretT(BoolT),
        mutability: Immutable,
        previewVersion: [2021,1,3],
    }));
})

const d2: Array<[Record<string, unknown>|null, Property]> = [
    [
        null,
        {
            description: "Not in version yet",
            type: StringT,
            previewVersion: [2021,6,6]
        }
    ],
    [
        {
            description: "Simple string",
            type: "string"
        },
        {
            description: "Simple string",
            type: StringT,
            previewVersion: [2021,1,3]
        }
    ],
    [
        {
            description: "Create only string",
            type: "string",
            "x-ms-mutability": ["create", "read"]
        },
        {
            description: "Create only string",
            type: StringT,
            mutability: Immutable,
            previewVersion: [2021,1,3],
        }
    ],
    [
        {
            description: "Read-only boolean",
            type: "boolean",
            "x-ms-mutability": ["read"],
            readOnly: true
        },
        {
            description: "Read-only boolean",
            type: BoolT,
            mutability: ReadOnly,
            previewVersion: [2021,1,3],
        }
    ],
    [
        {
            description: "Int32 field",
            type: "integer",
            format: "int32"
        },
        {
            description: "Int32 field",
            type: Int32T,
            previewVersion: [2021,1,3]
        }
    ],
    [
        {
            description: "Int64 field",
            type: "integer",
            format: "int64"
        },
        {
            description: "Int64 field",
            type: Int64T,
            previewVersion: [2021,1,3]
        }
    ],
    [
        {
            description: "Float field",
            type: "number",
            format: "double"
        },
        {
            description: "Float field",
            type: FloatT,
            previewVersion: [2021,1,3]
        }
    ],
    [
        {
            description: "Enum field",
            type: "string",
            enum: [
                "Alpha",
                "Beta",
                "Gamma",
            ],
            "x-ms-enum": {
                modelAsString: true,
                name: "MyPropertyEnum",
            }
        },
        {
            description: "Enum field",
            type: EnumT(["Alpha", "Beta", "Gamma"]),
            previewVersion: [2021,1,3],
        }
    ],
    [
        {
            description: "Secret string",
            type: "string",
            "x-ms-secret": true,
            "x-ms-mutability": ["create", "write"]
        },
        {
            description: "Secret string",
            type: SecretT(StringT),
            mutability: WriteOnly,
            previewVersion: [2021,1,3],
        }
    ],
    [
        {
            description: "Array of int32",
            type: "array",
            items: {
                type: "integer",
                format: "int32"
            }
        },
        {
            description: "Array of int32",
            type: ArrayT(Int32T),
            previewVersion: [2021,1,3],
        }
    ],
    [
        {
            description: "Object with no required fields",
            type: "object",
            properties: {
                "field1": {
                    description: "Field1",
                    type: "string",
                    "x-ms-mutability": ["create", "read"]
                },
                "field2": {
                    description: "Field2",
                    type: "array",
                    items: {
                        type: "string"
                    },
                    readOnly: true,
                    "x-ms-mutability": ["read"]
                }
            },
            required: ["field2"]
        },
        {
            description: "Object with no required fields",
            previewVersion: [2021,1,3],
            type: ObjectT({
                field1: {
                    description: "Field1",
                    type: StringT,
                    mutability: Immutable,
                    previewVersion: [2021,1,3],
                },
                field2: {
                    description: "Field2",
                    type: ArrayT(StringT),
                    mutability: ReadOnly,
                    previewVersion: [2021,1,3],
                    required: true,
                }
            })
        }
    ],
    [
        {
            description: "Object with no required fields",
            type: "object",
            properties: {
                "field1": {
                    description: "Field1",
                    type: "string",
                    "x-ms-mutability": ["create", "read"]
                },
            }
        },
        {
            description: "Object with no required fields",
            previewVersion: [2021,1,3],
            type: ObjectT({
                field1: {
                    description: "Field1",
                    type: StringT,
                    mutability: Immutable,
                    previewVersion: [2021,1,3],
                },
                field2: {
                    description: "Field2",
                    type: ArrayT(StringT),
                    mutability: ReadOnly,
                    previewVersion: [2021,1,5],
                }
            })
        }
    ],
    [
        {
            description: "Certificates",
            type: "array",
            items: {
                type: "object",
                properties: {
                    "pem": {
                        type: "string",
                        description: "PEM of certificate"
                    }
                }
            }
        },
        {
            description: "Certificates",
            type: ArrayT(ObjectT({
                pem: {
                    type: StringT,
                    description: "PEM of certificate",
                    previewVersion: [2021,1,3],
                }
            })),
            previewVersion: [2021,1,3]
        }
    ]
];
for (const i in d2) {
    const [expected, input] = d2[i];

    Deno.test("serializeProperty(" + JSON.stringify(input) + ")", () =>
        assertEquals(expected, serializeProperty("myProperty", [[2021,1,3], VersionKind.Preview], input))
    )
}

Deno.test("No nested SecretT", () => {
    assertThrows(() => serializeProperty("myProperty", v, {
        description: "A description",
        type: SecretT(SecretT(StringT)),
        mutability: WriteOnly,
        previewVersion: [2021,1,3]
    }))
})


// // ------------------------

// const v20210301 : Version = [2021, 3, 1]

// const dbAccount : Resource = {
//     path: [["databaseAccounts", { name: "accountName", minLength: 3, maxLength: 50 }]],
//     readableName: "CosmosDB database account",
//     resourceKind: ResourceType.Tracked,
//     previewVersion: v20210301,
//     properties: {
//         delegatedManagementSubnetId: {
//             description: "Subnet to attach NICs to",
//             type: StringT,
//             mutability: Immutable,
//             previewVersion: v20210301
//         },
//         externalCertificates: {
//             description: "TLS certificates to authenticate gossip",
//             previewVersion: v20210301,
//             type: ArrayT(ObjectT({
//                 pem: {
//                     description: "PEM formatted public key",
//                     type: StringT,
//                     previewVersion: v20210301
//                 }
//             }))
//         },
//         initialAdminPassword: {
//             description: "Password to log in initially",
//             type: SecretT(StringT),
//             previewVersion: v20210301,
//             mutability: CreateOnly
//         }
//     },
//     examples: [
//         {
//             parameters: ["my-database-account"],
//             properties: {
//                 delegatedManagementSubnetId: "/subscriptions/.../subnet",
//                 externalCertificates: [
//                     {"pem": "sadfSDFSDFAFD"}
//                 ],
//                 initialAdminPassword: "mypassword"
//             },
//         }
//     ],
//     methods: {
//         fetchNodeStatus: {
//             description: "Get the status of all nodes",
//             previewVersion: v20210301,
//             returnType: ObjectT({
//                 value: {
//                     previewVersion: v20210301,
//                     description: "Node statuses",
//                     type: Object({
//                         dc: {
//                             description: "Data center the node is in",
//                             type: StringT,
//                             previewVersion: v20210301
//                         }
//                     })
//                 }
//             }),
//             example: {
//                 value: [
//                     {dc: "dc1"}
//                 ]
//             }
//         }
//     }
// }

// const cosmosDb : Module = {
//     name: "cosmos-db",
//     previewVersion: v20210301,
//     resourceProvider: "Microsoft.DocumentDB",
//     resources: [dbAccount]
// }



// Deno.test("test1", () => {
//     //assertEquals(3, add(2, 1));
// });