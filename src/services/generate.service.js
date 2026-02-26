/* eslint-disable style/indent */
/* eslint-disable no-throw-literal */
/* eslint-disable dot-notation */
/* eslint-disable node/no-process-env */

/* eslint-disable no-unused-vars */

// import ExcelJS from "exceljs";
import fs from "node:fs";
import Docxtemplater from "docxtemplater";
import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import libre from "libreoffice-convert";
import PizZip from "pizzip";
import odooService from "./odoo.service.js";

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function generateInvoices(body) {
  try {
    const invoice = await odooService.getInvoiceWithLines(body.id);
    if (!invoice) {
      throw (`Invoice with id ${body.id} not found`);
    }

    const rawCustomer = invoice.partner_id?.[1] || "";
    const customer = normalizeCustomer(rawCustomer);
    const isDlh = customer.includes("DLH");

    const invoiceDateFormatted = formatInvoiceDate(invoice.invoice_date);
    const invoiceLine = invoice.product_lines?.[0];

    if (!invoiceLine) {
      throw new Error("Invoice tidak memiliki product line");
    }

    const invoiceInfo = extractInvoiceInfo(invoiceLine.name, isDlh);

    const number = await numberDocSpreadSheet();

    const baseData = {
      number: number.lastInvoice,
      kwitansi_number: number.lastKuitansi,
      invoice_date: invoiceDateFormatted,
      product: invoiceInfo.product,
      quantity: invoiceLine.quantity,
      today: invoiceDateFormatted,
      company: normalizeCompany(rawCustomer),
    };

    const templatePath = isDlh
      ? "./templates/template_gov_2.docx"
      : "./templates/template_invoices_2.docx";

    const renderData = isDlh
      ? {
        ...baseData,
        price_total: formatRupiahNumber(Number(invoice.amount_untaxed) + Number(getTaxPrice("12%", invoice.tax_lines))),
        terbilang: terbilangRupiah(
          invoice.amount_untaxed + getTaxPrice("12%", invoice.tax_lines),
        ),
      }
      : {
        ...baseData,
        amount_untaxed: formatRupiahNumber(invoice.amount_untaxed),
        price_unit: formatRupiahNumber(invoiceLine.price_unit),
        price_subtotal: formatRupiahNumber(invoiceLine.price_subtotal),
        terbilang: terbilangRupiah(invoiceLine.price_total),
        price_total: formatRupiahNumber(invoiceLine.price_total),
        tax_12: formatRupiahNumber(
          getTaxPrice("12%", invoice.tax_lines),
        ),
        tax_pph: formatRupiahNumber(
          getTaxPrice("PPh 23", invoice.tax_lines),
        ),
      };

    const pdfBuffer = await generatePdfFromTemplate(templatePath, renderData);

    const filename = `invoices_${sanitizeFilename(
      customer,
    )}_${invoiceDateFormatted}.pdf`;

    await odooService.mainProcess(pdfBuffer, ["Faktur penagihan"], filename);
  }
  catch (error) {
    console.error(error);
    return {
      error,
    };
  }

  // return `./tmp/invoices_${name}.docx`;
}

function normalizeCustomer(name) {
  const mapping = {
    "Pak Eko (Spinning)": "Indorama Spinning",
    "Ibu Metha (Bcp)": "BCP",
    "Ibu Maya (Sinar Pangjaya)": "Sinar Pangjaya",
    "Ibu Eliza (Daliatex)": "Daliatex",
    "Ibu Hera (Indorama Polyester)": "Indorama Polyester",
    "Ibu Mayang (gistex)": "Gistex",
    "Pak Gumilar DLH KOta BAndung": "DLH Kota Bandung",
    "DLH Karawang, Ibu Desy": "DLH Kab. Karawang",
  };

  return mapping[name] || name;
}

function normalizeCompany(name) {
  const mapping = {
    "Pak Khoiri (LPA)": "PT Lucky Print Abadi",
    "Pak Eko (Spinning)": "PT. Indorama Syntethics Div. Spinning",
    "Ibu Metha (Bcp)": "PT. Bintang Cipta Perkasa",
    "Ibu Maya (Sinar Pangjaya)": "PT. Sinar Pangjaya Mulya",
    "Ibu Eliza (Daliatex)": "PT. Daliatex",
    "Ibu Hera (Indorama Polyester)": "PT. Indorama Polyester",
    "Ibu Mayang (gistex)": "PT. Gistex",
    "Pak Gumilar DLH KOta BAndung": "Dinas Lingkungan Hidup Kota Bandung",
    "DLH Karawang, Ibu Desy": "Dinas Lingkungan Hidup Kab. Karawang",
  };

  return mapping[name] || name;
}

function formatInvoiceDate(date) {
  return new Date(date).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function sanitizeFilename(text) {
  return text.replace(/[^\w\s]/g, "").replace(/\s+/g, "_");
}

async function generatePdfFromTemplate(templatePath, data) {
  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.render(data);

  const buffer = doc.toBuffer();

  return new Promise((resolve, reject) => {
    libre.convert(buffer, ".pdf", "writer_pdf_Export", (err, done) => {
      if (err) {
        reject(err);
      }
      else {
        resolve(done);
      }
    });
  });
}

function extractInvoiceInfo(description, isDLH = false) {
  if (!description) {
    return {};
  }

  // 🔹 Ambil nomor setelah "Nomor:"
  const nomorMatch = description.match(/Nomor:\s*(\d+)/i);
  const nomor = nomorMatch ? nomorMatch[1] : null;

  let product = null;

  if (isDLH) {
    const firstLine = description.split("\n")[0]?.trim();
    product = firstLine || null;
  }
  else {
    // ✅ Normal case → ambil periode dari format Month
    const periodeMatch = description.match(
      /\d+\s*Month.*\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/i,
    );

    product = periodeMatch
      ? `Layanan Alat Sparing Periode ${formatPeriodeIndonesia(periodeMatch[0])}`
      : null;
  }

  return {
    nomor,
    product,
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

function terbilang(n) {
  const angka = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];

  n = Math.floor(n);

  if (n < 12) {
    return angka[n];
  }
  else if (n < 20) {
    return `${terbilang(n - 10)} belas`;
  }
  else if (n < 100) {
    return (
      `${terbilang(Math.floor(n / 10))
      } puluh ${terbilang(n % 10)}`
    );
  }
  else if (n < 200) {
    return `seratus ${terbilang(n - 100)}`;
  }
  else if (n < 1000) {
    return (
      `${terbilang(Math.floor(n / 100))
      } ratus ${terbilang(n % 100)}`
    );
  }
  else if (n < 2000) {
    return `seribu ${terbilang(n - 1000)}`;
  }
  else if (n < 1000000) {
    return (
      `${terbilang(Math.floor(n / 1000))
      } ribu ${terbilang(n % 1000)}`
    );
  }
  else if (n < 1000000000) {
    return (
      `${terbilang(Math.floor(n / 1000000))
      } juta ${terbilang(n % 1000000)}`
    );
  }
  else if (n < 1000000000000) {
    return (
      `${terbilang(Math.floor(n / 1000000000))
      } miliar ${terbilang(n % 1000000000)}`
    );
  }
  else {
    return (
      `${terbilang(Math.floor(n / 1000000000000))
      } triliun ${terbilang(n % 1000000000000)}`
    );
  }
}

function terbilangRupiah(n) {
  return (
    `${terbilang(n)
      .replace(/\s+/g, " ")
      .trim()} rupiah`
  );
}

async function numberDocSpreadSheet() {
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

  await doc.loadInfo();

  const sheet = doc.sheetsByTitle["Invoice"];
  const rows = await sheet.getRows();

  // ambil kolom "Nomor Invoice"
  const values = rows
    .map(row => row.get("Nomor Invoice"))
    .filter(val => val && val !== "");

  const sheet2 = doc.sheetsByTitle["Kuitansi"];
  const rows2 = await sheet2.getRows();

  // ambil kolom "Nomor Invoice"
  const values2 = rows2
    .map(row => row.get("Nomor Kuitansi"))
    .filter(val => val && val !== "");

  const lastInvoice = values.length
    ? values[values.length - 1]
    : null;

  const lastKuitansi = values2.length
    ? values2[values2.length - 1]
    : null;

  return {
    lastInvoice,
    lastKuitansi,
  };
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

{
  id: 36004,
  name: 'INV/2026/00023',
  invoice_date: '2026-02-26',
  invoice_date_due: '2026-02-26',
  partner_id: [ 119, 'DLH Karawang, Ibu Desy' ],
  amount_untaxed: 130800000,
  amount_tax: 13734000,
  amount_total: 144534000,
  invoice_line_ids: [ 75278 ],
  line_ids: [ 75278, 75279, 75280, 75281 ],
  currency_id: [ 12, 'IDR' ],
  state: 'posted',
  product_lines: [
    {
      id: 75278,
      name: 'Pemeliharaan dan Perbaikan Sistem Pemantauan Kualitas Udara\nnomor: 012',
      product_id: [Array],
      quantity: 1,
      price_unit: 130800000,
      tax_ids: [Array],
      price_subtotal: 130800000,
      price_total: 144534000
    }
  ],
  tax_lines: [
    {
      id: 75279,
      name: '12%',
      tax_line_id: [Array],
      debit: 0,
      credit: 15696000,
      account_id: [Array]
    },
    {
      id: 75280,
      name: 'PPh 22',
      tax_line_id: [Array],
      debit: 1962000,
      credit: 0,
      account_id: [Array]
    }
  ]
}
*/
