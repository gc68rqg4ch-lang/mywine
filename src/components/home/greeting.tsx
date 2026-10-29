"use client";

import { useEffect, useState } from "react";
import { greetingText } from "@/lib/home/greeting";

/**
 * Begrüssung vor Antoines Text nach der Uhrzeit im Browser (Europe/Zurich). Der Server liefert sie
 * schon mit; im Browser wird sie beim Laden, beim Zurückkehren auf die Seite (auch aus dem
 * Zwischenspeicher) und jede Minute neu bestimmt – eine alte Seite zeigt so nie die falsche
 * Tageszeit.
 */
export function Greeting({ person, initial }: { person: string | null; initial: string }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const update = () => setText(greetingText(person, Date.now()));
    update();
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [person]);
  return <span className="antoine-greeting">{text}</span>;
}
