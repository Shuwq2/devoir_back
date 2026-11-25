const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Mon API fonctionne !");
});

app.listen(3000, () => {
  console.log("API disponible sur http://localhost:3000");
});