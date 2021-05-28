import {
    Version, VersionKind, TargetVersion,
    Module,
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
    resources: []
};

generateSwagger(module, "Microsoft.Example", targetVersions);