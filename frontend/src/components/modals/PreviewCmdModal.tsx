import React from 'react';
import { ClipboardIcon } from '../Icons';

interface PreviewCmdModalProps {
  previewCmd: string;
  onClose: () => void;
}

export const PreviewCmdModal: React.FC<PreviewCmdModalProps> = ({
  previewCmd,
  onClose,
}) => {
  const handleCopy = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(previewCmd)
        .then(() => alert("Comando copiado al portapapeles."))
        .catch(() => fallbackCopy(previewCmd));
    } else {
      fallbackCopy(previewCmd);
    }
  };

  const fallbackCopy = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        alert("Comando copiado al portapapeles.");
      } else {
        alert("No se pudo copiar el comando. Por favor, cópielo manualmente.");
      }
    } catch (err) {
      alert("No se pudo copiar el comando. Por favor, cópielo manualmente.");
    }
    document.body.removeChild(textArea);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-3xl shadow-2xl flex flex-col">
        <h3 className="text-xl font-black text-white mb-4">FFmpeg Command Preview</h3>
        <div className="bg-black border border-white/10 p-4 rounded-xl mb-6 overflow-x-auto custom-scrollbar font-mono text-sm text-brand-lime break-all">
          {previewCmd}
        </div>
        <div className="flex justify-end gap-3 mt-auto">
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold transition-all flex items-center gap-1.5"
          >
            <ClipboardIcon size={14} /> Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-brand-orange text-black rounded-lg font-bold hover:bg-orange-400 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
export default PreviewCmdModal;
