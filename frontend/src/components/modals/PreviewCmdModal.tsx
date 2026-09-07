import React, { useState } from 'react';
import { ClipboardIcon, CheckIcon } from '../Icons';
import { copyToClipboard } from '../../utils/clipboard';

interface PreviewCmdModalProps {
  previewCmd: string;
  onClose: () => void;
}

export const PreviewCmdModal: React.FC<PreviewCmdModalProps> = ({
  previewCmd,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(previewCmd);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg flex items-center gap-2 transition-all cursor-pointer font-bold"
          >
            {copied ? <CheckIcon size={14} /> : <ClipboardIcon size={14} />}
            <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
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
