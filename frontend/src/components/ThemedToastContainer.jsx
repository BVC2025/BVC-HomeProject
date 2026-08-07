import { useEffect, useState } from "react";
import { ToastContainer } from "react-toastify";

/* Live-tracks the root `data-theme` attribute (same pattern as
   MyAllowanceSection.jsx) so toasts switch between light/dark
   styling along with the rest of the app instead of always
   rendering with react-toastify's hardcoded light theme. */
function useDarkMode() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" &&
          document.documentElement.getAttribute("data-theme") === "dark"
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export default function ThemedToastContainer() {
  const dark = useDarkMode();

  return (
    <ToastContainer
      position="top-right"
      autoClose={3500}
      hideProgressBar={false}
      closeOnClick
      pauseOnHover
      draggable
      theme={dark ? "dark" : "light"}
    />
  );
}
