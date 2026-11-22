export function isWelfareShopCommand(item) {
  return item?.eventType === 'message' && item.messageType === 'text' &&
    item.sourceType === 'user' && Boolean(item.replyToken) &&
    String(item.text || '').trim() === '員工福利品';
}

export function isWelfareShopEvent(event) {
  return isWelfareShopCommand({
    eventType: event?.type, messageType: event?.message?.type,
    sourceType: event?.source?.type, replyToken: event?.replyToken, text: event?.message?.text
  });
}

export function buildWelfareShopMessage(buildLiff) {
  const uri = buildLiff('/welfare-shop');
  if (!/^https:\/\/liff\.line\.me\/[0-9A-Za-z_-]+\/welfare-shop$/.test(uri)) {
    throw new Error('Invalid shop LIFF URL');
  }
  return {
    type: 'flex',
    altText: '員工福利品商城',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: '員工福利品商城', weight: 'bold', size: 'lg', wrap: true }
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', action: { type: 'uri', label: '開啟福利品商城', uri } }
      ] }
    }
  };
}
