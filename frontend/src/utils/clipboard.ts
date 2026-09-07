/**
 * Universal clipboard utility with automatic fallback for non-secure HTTP environments (e.g. LAN test nodes).
 * Modern browsers restrict navigator.clipboard to secure contexts (HTTPS or localhost).
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;

  // 1. Try modern navigator.clipboard if available and within a secure context
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard failed, falling back to execCommand', err);
    }
  }

  // 2. Robust fallback using a temporary hidden textarea and document.execCommand('copy')
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback copyToClipboard failed', err);
    return false;
  }
};
