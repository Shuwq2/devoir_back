import express from "express";
import router from "./route.js";

const app = express();

app.use("/", router);

app.listen(3000, () => {
  console.log("API disponible sur http://localhost:3000");
});