export const installGooglePickerStyles = () => {
  const existing = document.getElementById('ledger-google-picker-styles');
  if (existing) {
    // Google injects its own stylesheet when Picker is shown. Moving this
    // override to the end keeps Ledger's modal treatment authoritative.
    document.head.appendChild(existing);
    return;
  }
  const style = document.createElement('style');
  style.id = 'ledger-google-picker-styles';
  style.textContent = `
    .picker-dialog-bg {
      /* The Picker is opened after Ledger's own modal closes. A second dim
         layer makes the transparent desktop shell read like a mismatched
         nested window, so keep Google's blocking backdrop transparent. */
      background: transparent !important;
    }
    .picker-dialog {
      border: 1px solid rgba(243, 215, 190, 0.9) !important;
      border-radius: 16px !important;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24) !important;
      overflow: hidden !important;
    }
    .picker-dialog-content,
    .picker-dialog-content iframe {
      border-radius: 16px !important;
      overflow: hidden !important;
    }
  `;
  document.head.appendChild(style);
};
