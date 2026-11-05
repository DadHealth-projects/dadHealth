import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Dad Dates admin API isolates official rows for every management operation", async () => {
  const route = await read("src/app/api/admin/[resource]/route.ts");
  const admin = route.slice(route.indexOf("export async function GET"));

  assert.match(route, /async function verifyAdmin\(\)[\s\S]*?return session === adminKey/);
  assert.match(admin, /case "dad_dates": \{[\s\S]*?\.from\("dad_dates"\)[\s\S]*?\.eq\("source", "admin"\)[\s\S]*?\.is\("user_id", null\)/);
  assert.match(admin, /\.insert\(\{ \.\.\.parsed\.value, source: "admin", user_id: null \}\)/);

  const patch = admin.slice(admin.indexOf("export async function PATCH"), admin.indexOf("export async function DELETE"));
  assert.match(patch, /if \(resource === "dad_dates"\)[\s\S]*?\.update\(parsed\.value\)[\s\S]*?\.eq\("source", "admin"\)[\s\S]*?\.is\("user_id", null\)[\s\S]*?if \(!data\).*status: 404/s);
  assert.match(route, /if \("source" in body \|\| "user_id" in body\)[\s\S]*?Dad Date ownership cannot be changed/);

  const remove = admin.slice(admin.indexOf("export async function DELETE"));
  assert.match(remove, /if \(resource === "dad_dates"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("source", "admin"\)[\s\S]*?\.is\("user_id", null\)[\s\S]*?if \(!data\).*status: 404/s);
});

test("Dad Dates admin form supports validated create, edit, and confirmed delete", async () => {
  const page = await read("src/app/admin/page.tsx");
  const tab = page.slice(page.indexOf("function DadDatesTab()"), page.indexOf("function ExpertEventsTab()"));

  for (const expected of [
    'method: wasEditing ? "PATCH" : "POST"',
    'method: "DELETE"',
    'if (!confirm("Delete this Dad Date idea?")) return;',
    "setItems((current) => current.filter((item) => item.id !== id))",
    "Enter the activity name, icon, age range, and budget.",
    "Number.isInteger(duration)",
    "isHttpBookingUrl(bookingUrl)",
    "Edit Dad Date Idea",
    "Cancel editing",
    "Dad Date idea added.",
    "Dad Date idea updated.",
    "Dad Date idea deleted.",
    "Booking required",
    "Address / location",
    "Description",
  ]) {
    assert.ok(tab.includes(expected), `Missing Dad Dates admin behavior: ${expected}`);
  }
});
