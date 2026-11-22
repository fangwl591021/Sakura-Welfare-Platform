export function validateVendorPortalCredentialInput({
  username,
  password,
  existingUsername = "",
  existingPassword = "",
} = {}) {
  const incomingUsername = String(username || "").trim();
  const incomingPassword = String(password || "").trim();
  const savedUsername = String(existingUsername || "").trim();
  const savedPassword = String(existingPassword || "").trim();
  const finalUsername = incomingUsername || savedUsername;

  if (!finalUsername) {
    return { success: false, message: "請設定店家登入帳號。" };
  }
  if (finalUsername.length < 4 || finalUsername.length > 64 || /\s/.test(finalUsername)) {
    return { success: false, message: "店家登入帳號需為 4 至 64 個字元，且不可包含空白。" };
  }
  if (!incomingPassword && !savedPassword) {
    return { success: false, message: "請設定店家登入密碼。" };
  }
  if (incomingPassword && (incomingPassword.length < 8 || incomingPassword.length > 128)) {
    return { success: false, message: "店家登入密碼需為 8 至 128 個字元。" };
  }

  return {
    success: true,
    username: finalUsername,
    password: incomingPassword,
    passwordChanged: Boolean(incomingPassword),
  };
}
