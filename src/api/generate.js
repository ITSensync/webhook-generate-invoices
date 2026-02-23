import express from "express";
import generateController from "../controller/generate.controller.js";

const router = express.Router();

router.post("/invoices", generateController.generateInvoices);

export default router;
