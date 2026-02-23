import generateService from "../services/generate.service.js";

async function generateInvoices(req, res) {
  const result = await generateService.generateInvoices(req.body);

  res.json(result);

  /* const { buffer, filename } = await generateService.BAKorektif(req.body, req.files);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  res.send(buffer); */
}

export default {
  generateInvoices,
};
