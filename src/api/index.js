import express from "express";
import generate from "./generate.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    message: "API - WEBHOOK INVOICES",
  });
});

router.use("/generate", generate);

export default router;
