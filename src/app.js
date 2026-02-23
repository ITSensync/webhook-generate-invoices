/* eslint-disable no-console */
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import api from "./api/index.js";

import * as middlewares from "./middlewares.js";

const app = express();

app.use(morgan("dev"));
app.use(helmet());
app.use(cors({
  origin: "*", // frontend kamu
  credentials: false,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1", api);

app.use(middlewares.notFound);
app.use(middlewares.errorHandler);

export default app;
