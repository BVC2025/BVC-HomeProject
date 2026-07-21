import { toast } from "react-toastify";

const OPTIONS = {
  position: "top-right",
  autoClose: 3500,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
};

export function useToast() {
  return {
    showSuccess: (msg) => toast.success(msg, OPTIONS),
    showError: (msg) => toast.error(msg, OPTIONS),
    showInfo: (msg) => toast.info(msg, OPTIONS),
    showWarning: (msg) => toast.warning(msg, OPTIONS),
  };
}
