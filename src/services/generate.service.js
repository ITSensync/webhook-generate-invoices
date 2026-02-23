/* eslint-disable node/prefer-global/buffer */
// import ExcelJS from "exceljs";

async function generateInvoices(body) {
  console.log(body);
}

async function previewFile(filename) {
  return { filePath: `./tmp/${filename}` };
}

export default {
  previewFile,
  generateInvoices,
};
