import { registryContract } from "./contract";
import { InMemoryRegistry } from "./in-memory";

registryContract("InMemoryRegistry", async () => new InMemoryRegistry());
