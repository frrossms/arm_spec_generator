import {
    Version, VersionKind, TargetVersion,
    Module,
    ResourceType,
    StringT,
    generateSwagger
} from "../src/main.ts";

const targetVersions: Array<TargetVersion> = [
    [[2021,3,1], VersionKind.Preview],
    [[2021,4,1], VersionKind.Preview],
    [[2021,4,15], VersionKind.GA]
]

const module: Module = {
    filename: "example.json",
    title: "Example",
    description: "Example module to generate Swagger generation.",
    namespace: "Microsoft.Example",
    resources: [
        {
            previewVersion: [2021,4,1],
           path: [
               [
                   "genericResources", 
                   {
                        name: "resourceName"
                   }
                ]
            ],
            resourceType: ResourceType.Tracked,
            readableName: "generic resource",
            readablePluralName: "generic resources",
            properties: {
                "field1": {
                    previewVersion: [2021,4,1],
                    description: "First field of the resource.",
                    type: StringT
                }
            }
        }
    ]
};

generateSwagger(module, "Microsoft.Example", targetVersions);