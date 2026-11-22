import React from "react";
import ReactDOM from "react-dom/client";
import LyricsPlayerApp from "./LyricsPlayerApp";
import "../styles/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LyricsPlayerApp />
  </React.StrictMode>,
);
