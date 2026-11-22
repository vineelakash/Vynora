import React from "react";
import ReactDOM from "react-dom/client";
import VinylApp from "./VinylApp";
import "./vinyl.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <VinylApp />
  </React.StrictMode>,
);
