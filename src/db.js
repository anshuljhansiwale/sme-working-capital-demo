import { MongoClient } from "mongodb";

const DB_NAME = "sme_working_capital";

let client;
let database;
let memoryServer;

/**
 * One shared client for the process.
 * Pool and timeout settings stay at driver defaults: this is one demo process
 * with a single presenter, not a tuned production pool.
 * MONGODB_URI uses that cluster. With no URI, an ephemeral MongoDB holds the
 * session so the webpage can switch among finished cases.
 */
export async function getDb() {
  if (database) return database;

  let uri = process.env.MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }

  client = new MongoClient(uri);
  await client.connect();
  database = client.db(DB_NAME);
  await database.collection("cases").createIndex({ caseId: 1 }, { unique: true });
  await database.collection("fixtures").createIndex({ caseId: 1 }, { unique: true });
  return database;
}

export async function closeDb() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
  if (memoryServer) await memoryServer.stop();
  memoryServer = undefined;
}
