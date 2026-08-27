import { db } from "./src/test/db/store.js";
import { makeOpportunity } from "./src/test/factories.js";

console.log("Before makeOpportunity, stages:", db.internal.rowsOf("crm_pipeline_stages").length);
try {
  makeOpportunity();
  console.log("Success! Stages length:", db.internal.rowsOf("crm_pipeline_stages").length);
} catch (e) {
  console.error("Error:", e);
  console.log("Stages length after error:", db.internal.rowsOf("crm_pipeline_stages").length);
  console.log("Stages in DB:", db.internal.rowsOf("crm_pipeline_stages"));
}
