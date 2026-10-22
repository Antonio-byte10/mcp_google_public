import { readFileSync } from "node:fs";
import { RAIZ } from "./navegador.js";

export const VERSAO: string = JSON.parse(readFileSync(`${RAIZ}/package.json`, "utf8")).version;
