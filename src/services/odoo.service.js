/* eslint-disable no-console */
/* eslint-disable node/no-process-env */

import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import mime from "mime-types";
import { CookieJar } from "tough-cookie";

const jar = new CookieJar();

const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
  }),
);

const ODOO_URL = process.env.ODOO_URL;
const DB = process.env.ODOO_DB;
const USERNAME = process.env.ODOO_USERNAME;
const PASSWORD = process.env.ODOO_PASSWORD;

async function odooLogin() {
  const res = await client.post(`${ODOO_URL}/web/session/authenticate`, {
    jsonrpc: "2.0",
    params: {
      db: DB,
      login: USERNAME,
      password: PASSWORD,
    },
  });

  if (!res.data.result?.uid) {
    throw new Error("Login gagal (credential / DB salah)");
  }

  console.log("✅ Login OK:", res.data.result.uid);
}

async function callKw(model, method, args = [], kwargs = {}) {
  const res = await client.post(`${ODOO_URL}/web/dataset/call_kw`, {
    jsonrpc: "2.0",
    method: "call",
    params: { model, method, args, kwargs },
  });

  if (res.data.error)
    throw new Error(JSON.stringify(res.data.error));

  return res.data.result;
}

async function getOrCreateFolder(name, parentId = null) {
  const domain = [
    ["name", "=", name],
    ["type", "=", "folder"],
  ];

  if (parentId) {
    domain.push(["folder_id", "=", parentId]);
  }

  const found = await callKw(
    "documents.document",
    "search_read",
    [domain],
    { fields: ["id"], limit: 1 },
  );

  if (found.length)
    return found[0].id;

  return await callKw("documents.document", "create", [
    {
      name,
      type: "folder",
      folder_id: parentId || false,
    },
  ]);
}

async function searchFolder(cookie, name) {
  const payload = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      model: "documents.document",
      method: "search_read",
      args: [[["name", "=", name], ["type", "=", "folder"]]],
      kwargs: { fields: ["id", "name"], limit: 1 },
    },
  };

  const res = await axios.post(
    `${ODOO_URL}/web/dataset/call_kw`,
    payload,
    { headers: { Cookie: cookie } },
  );

  console.log(res.data);

  return res.data.result[0]?.id || null;
}

async function uploadBuffer(buffer, filename, folderId) {
  const base64 = buffer.toString("base64");

  // 1️⃣ create
  const docId = await callKw("documents.document", "create", [
    {
      name: filename,
      datas: base64,
      mimetype: mime.lookup(filename) || "application/octet-stream",
      folder_id: folderId,
    },
  ]);

  // 2️⃣ ambil token
  const [doc] = await callKw(
    "documents.document",
    "read",
    [[docId]],
    { fields: ["access_token"] },
  );

  const url = `${ODOO_URL}/web/content/${docId}?download=true`;

  const publicUrl = doc.access_token
    ? `${ODOO_URL}/web/content/${docId}?access_token=${doc.access_token}`
    : url;

  return {
    id: docId,
    url,
    publicUrl,
  };
}

async function getById(model, ids = [], fields = []) {
  if (!ids.length) {
    return [];
  }

  return await callKw(
    model,
    "read",
    [ids],
    { fields },
  );
}

async function searchRead(model, domain = [], fields = [], limit = 0) {
  return await callKw(
    model,
    "search_read",
    [domain],
    { fields, limit },
  );
}

/**
 * Ambil invoice lengkap + detail invoice_line_ids
 */
async function getInvoiceWithLines(moveId) {
  await odooLogin();
  // 1️⃣ Ambil invoice utama
  const [invoice] = await getById(
    "account.move",
    [moveId],
    [
      "id",
      "name",
      "invoice_date",
      "invoice_date_due",
      "partner_id",
      "amount_untaxed",
      "amount_tax",
      "amount_total",
      "invoice_line_ids",
      "line_ids",
      "currency_id",
      "state",
    ],
  );

  if (!invoice) {
    return null;
  }

  // 2️⃣ Ambil detail product lines
  let productLines = [];
  if (invoice.invoice_line_ids?.length) {
    productLines = await getById(
      "account.move.line",
      invoice.invoice_line_ids,
      [
        "id",
        "name",
        "product_id",
        "quantity",
        "price_unit",
        "tax_ids",
        "price_subtotal",
        "price_total",
      ],
    );
  }

  // 3️⃣ Ambil tax lines (dari journal entries)
  let taxLines = [];
  if (invoice.line_ids?.length) {
    const allLines = await getById(
      "account.move.line",
      invoice.line_ids,
      [
        "id",
        "name",
        "tax_line_id",
        "debit",
        "credit",
        "account_id",
      ],
    );

    // filter hanya baris pajak
    taxLines = allLines.filter(l => l.tax_line_id);
  }

  return {
    ...invoice,
    product_lines: productLines,
    tax_lines: taxLines,
  };
}

async function mainProcess(buffer, folderPath = [], fileName) {
  await odooLogin();

  let parentId = null;

  // buat / cari folder berurutan
  for (const name of folderPath) {
    parentId = await getOrCreateFolder(name, parentId);
  }

  const result = await uploadBuffer(buffer, fileName, parentId);

  console.log("✅ Upload OK:", result);

  return result;
}

export default {
  odooLogin,
  searchFolder,
  mainProcess,
  searchRead,
  getInvoiceWithLines,
};
