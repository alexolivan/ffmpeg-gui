export const formatInputDesc = (inputCfg: any): string => {
  if (!inputCfg) return 'N/A';
  
  const isNewFormat = 'input1' in inputCfg;
  const input1 = isNewFormat ? inputCfg.input1 : inputCfg;
  
  const formatSingle = (inp: any) => {
    if (!inp || !inp.type) return '';
    const typeUpper = inp.type.toUpperCase();
    switch (inp.type) {
      case 'file':
        return `${typeUpper}(${inp.path || 'no path'})`;
      case 'srt':
      case 'udp':
        return `${typeUpper}(${inp.host || '0.0.0.0'}:${inp.port || ''})`;
      case 'ndi':
        return `${typeUpper}(${inp.source_name || inp.ndi_source || 'default'})`;
      case 'decklink':
        return `${typeUpper}(${inp.device || 'device'})`;
      case 'rtsp':
      case 'rtmp':
        return `${typeUpper}(${inp.url || 'url'})`;
      default:
        return typeUpper;
    }
  };

  const desc1 = formatSingle(input1) || 'N/A';
  if (isNewFormat && inputCfg.use_secondary_input && inputCfg.input2) {
    const desc2 = formatSingle(inputCfg.input2);
    return desc2 ? `${desc1} + ${desc2}` : desc1;
  }
  return desc1;
};

export const formatOutputDesc = (outputCfg: any): string => {
  if (!outputCfg || !outputCfg.type) return 'N/A';
  const typeUpper = outputCfg.type.toUpperCase();
  switch (outputCfg.type) {
    case 'file':
      return `${typeUpper}(${outputCfg.path || 'no path'})`;
    case 'srt':
    case 'udp':
      return `${typeUpper}(${outputCfg.host || '0.0.0.0'}:${outputCfg.port || ''})`;
    case 'ndi':
      return `${typeUpper}(${outputCfg.ndi_name || 'ndi'})`;
    case 'decklink':
      return `${typeUpper}(${outputCfg.device || 'device'})`;
    case 'rtsp':
    case 'rtmp':
      return `${typeUpper}(${outputCfg.url || 'url'})`;
    case 'hls':
      return `${typeUpper}(${outputCfg.hls_path || 'path'})`;
    default:
      return typeUpper;
  }
};
