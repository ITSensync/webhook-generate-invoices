/* eslint-disable no-unused-vars */
/* eslint-disable no-console */
/* eslint-disable node/prefer-global/buffer */
// import ExcelJS from "exceljs";
import fs from "node:fs";
import Docxtemplater from "docxtemplater";
import libre from "libreoffice-convert";
import PizZip from "pizzip";
import odooService from "./odoo.service.js";

async function generateInvoices(body) {
  const content = fs.readFileSync("./templates/template_invoices.docx", "binary");

  const invoice = await odooService.getInvoiceWithLines(body.id);

  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    // modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  const invoice_date = new Date(invoice.invoice_date).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const name = invoice.name;
  const invoiceInfo = extractInvoiceInfo(invoice.product_lines[0].name);
  const quantity = invoice.product_lines[0].quantity;
  const amount_untaxed = formatRupiahNumber(invoice.amount_untaxed);
  const price_unit = formatRupiahNumber(invoice.product_lines[0].price_unit);
  const price_subtotal = formatRupiahNumber(invoice.product_lines[0].price_subtotal);
  const price_total = formatRupiahNumber(invoice.product_lines[0].price_total);
  const tax_12 = formatRupiahNumber(getTaxPrice("12%", invoice.tax_lines));
  const tax_pph = formatRupiahNumber(getTaxPrice("PPh 23", invoice.tax_lines));

  doc.render({
    number: invoiceInfo.nomor,
    name,
    invoice_date,
    invoice_periode: invoiceInfo.periode,
    quantity,
    amount_untaxed,
    price_unit,
    price_subtotal,
    price_total,
    tax_12,
    tax_pph,
  });

  const buf = doc.toBuffer();

  // fs.writeFileSync(`./tmp/invoices_${invoice.partner_id[1]}_${invoice_date}.docx`, buf);

  const pdfBuf = await new Promise((resolve, reject) => {
    libre.convert(buf, ".pdf", "writer_pdf_Export", (err, done) => {
      if (err)
        reject(err);
      else resolve(done);
    });
  });

  const filename = `invoices_${invoice.partner_id[1]}_${invoice_date}.pdf`;
  await odooService.mainProcess(pdfBuf, ["invoice tagihan"], filename);

  // return `./tmp/invoices_${name}.docx`;
}

function extractInvoiceInfo(description) {
  if (!description) {
    return {};
  }

  // Ambil nomor setelah "Nomor:"
  const nomorMatch = description.match(/Nomor:\s*(\d+)/i);
  const nomor = nomorMatch ? nomorMatch[1] : null;

  // Ambil baris yang mengandung "Month"
  const periodeMatch = description.match(/\d+\s*Month.*\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/i);
  const periode = periodeMatch ? formatPeriodeIndonesia(periodeMatch[0]) : null;

  return {
    nomor,
    periode,
  };
}

function formatPeriodeIndonesia(periodeString) {
  if (!periodeString) {
    return null;
  };

  const bulanIndo = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  // Ambil tanggal dari string
  const match = periodeString.match(/(\d{2}\/\d{2}\/\d{4}).*(\d{2}\/\d{2}\/\d{4})/);
  if (!match) {
    return null;
  }

  const start = match[1];
  const end = match[2];

  const [startMonth, _startDay, startYear] = start.split("/");
  const [endMonth, _endDay, endYear] = end.split("/");

  const startMonthName = bulanIndo[Number.parseInt(startMonth) - 1];
  const endMonthName = bulanIndo[Number.parseInt(endMonth) - 1];

  // Kalau bulan & tahun sama
  if (startMonth === endMonth && startYear === endYear) {
    return `${startMonthName} ${startYear}`;
  }

  // Kalau beda bulan tapi tahun sama
  if (startYear === endYear) {
    return `${startMonthName} - ${endMonthName} ${startYear}`;
  }

  // Kalau beda tahun
  return `${startMonthName} ${startYear} - ${endMonthName} ${endYear}`;
}

function formatRupiahNumber(value) {
  if (value === null || value === undefined) {
    return "0";
  }

  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

async function previewFile(filename) {
  return { filePath: `./tmp/${filename}` };
}

function getTaxPrice(name, taxLines) {
  const resultTax = taxLines.find(tax => tax.name === name);
  return name === "12%" ? resultTax.credit : resultTax.debit;
}

export default {
  previewFile,
  generateInvoices,
};

/*
{
  id: 35989,
  name: 'INV/2026/00022',
  invoice_date: '2026-02-25',
  invoice_date_due: '2026-02-25',
  partner_id: [ 74, 'Pak Khoiri (LPA)' ],
  amount_untaxed: 19000000,
  amount_tax: 1854400,
  amount_total: 20854400,
  invoice_line_ids: [ 75232 ],
  line_ids: [ 75232, 75233, 75234, 75235 ],
  currency_id: [ 12, 'IDR' ],
  state: 'posted',
  product_lines: [
    {
      id: 75232,
      name: 'Service sparing - PMT, LPA, Daliatex\n' +
        'Periode layanan Januari 26\n' +
        '1 Month 01/01/2026 to 01/31/2026\n' +
        'Nomor: 13',
      product_id: [Array],
      quantity: 1,
      price_unit: 19000000,
      tax_ids: [Array],
      price_subtotal: 19000000,
      price_total: 20854400
    }
  ],
  tax_lines: [
    {
      id: 75233,
      name: 'PPh 23',
      tax_line_id: [Array],
      debit: 380000,
      credit: 0,
      account_id: [Array]
    },
    {
      id: 75234,
      name: '12%',
      tax_line_id: [Array],
      debit: 0,
      credit: 2234400,
      account_id: [Array]
    }
  ]
}
*/
