import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
const source=await readFile("worker/server.mjs","utf8");
const html=await readFile("worker/page.html","utf8");
if(!source.includes('/*__PAGE__*/ ""'))throw new Error("Missing page marker");
await mkdir("dist/server",{recursive:true});await mkdir("dist/.openai",{recursive:true});
await writeFile("dist/server/index.js",source.replace('/*__PAGE__*/ ""',()=>JSON.stringify(html)));
await copyFile(".openai/hosting.json","dist/.openai/hosting.json");
console.log("Built personal creative library (Worker + durable attachments).");
