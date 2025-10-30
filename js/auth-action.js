/**
 * Firebase Auth Action Handler
 * Handles email verification and password reset flows from Firebase email links
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { 
  getAuth, 
  applyActionCode, 
  verifyPasswordResetCode, 
  confirmPasswordReset 
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const oobCode = params.get("oobCode");

// DOM elements
const pageTitle = document.getElementById("pageTitle");
const status = document.getElementById("status");
const errorMessage = document.getElementById("errorMessage");
const successMessage = document.getElementById("successMessage");
const passwordResetForm = document.getElementById("passwordResetForm");
const actionButtons = document.getElementById("actionButtons");
const goToLoginBtn = document.getElementById("goToLoginBtn");
const goToDashboardBtn = document.getElementById("goToDashboardBtn");

// Password reset form elements
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");
const resetPasswordBtn = document.getElementById("resetPasswordBtn");
const cancelResetBtn = document.getElementById("cancelResetBtn");
const passwordStrength = document.getElementById("passwordStrength");

// Password toggle elements
const toggleNewPassword = document.getElementById("toggleNewPassword");
const toggleConfirmPassword = document.getElementById("toggleConfirmPassword");
const newPasswordEyeIcon = document.getElementById("newPasswordEyeIcon");
const confirmPasswordEyeIcon = document.getElementById("confirmPasswordEyeIcon");

// Password toggle functionality
function setupPasswordToggle(buttonId, inputId, iconId) {
  const toggleBtn = document.getElementById(buttonId);
  const passwordInput = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  
  if (!toggleBtn || !passwordInput || !icon) return;
  
  const togglePassword = () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    toggleBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    
    // Update icon based on visibility
    if (isPassword) {
      // Show eye-off icon (crossed out eye)
      icon.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      `;
    } else {
      // Show eye icon
      icon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      `;
    }
  };
  
  // Click handler
  toggleBtn.addEventListener('click', togglePassword);
  
  // Keyboard handler (Enter and Space)
  toggleBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePassword();
    }
  });
}

// Password strength checker
function checkPasswordStrength(password) {
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasMinLength = password.length >= 8;
  
  const strengthCount = [hasUppercase, hasLowercase, hasNumber, hasMinLength].filter(Boolean).length;
  
  if (strengthCount < 2) return { level: 'weak', text: 'Weak password' };
  if (strengthCount < 4) return { level: 'medium', text: 'Medium strength' };
  return { level: 'strong', text: 'Strong password' };
}

// Update password strength indicator
function updatePasswordStrength() {
  const password = newPasswordInput.value;
  if (!password) {
    passwordStrength.textContent = '';
    passwordStrength.className = 'password-strength';
    return;
  }
  
  const strength = checkPasswordStrength(password);
  passwordStrength.textContent = strength.text;
  passwordStrength.className = `password-strength strength-${strength.level}`;
}

// Show error message
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  successMessage.style.display = 'none';
}

// Show success message
function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.style.display = 'block';
  errorMessage.style.display = 'none';
}

// Hide all messages
function hideMessages() {
  errorMessage.style.display = 'none';
  successMessage.style.display = 'none';
}

// Handle email verification
async function handleEmailVerification() {
  try {
    pageTitle.textContent = "Verifying your email...";
    status.textContent = "Please wait while we verify your email address.";
    
    await applyActionCode(auth, oobCode);
    
    // Try to refresh current user session if available
    try { await auth.currentUser?.reload?.(); } catch (_) {}
    try { sessionStorage.setItem('emailJustVerified', '1'); } catch(_) {}

    showSuccess("✅ Email verified successfully!");
    pageTitle.textContent = "Email Verified";
    status.textContent = "Your email has been verified. You can now access your dashboard.";
    
    // Show action buttons
    actionButtons.style.display = 'block';
    goToLoginBtn.style.display = 'none'; // Hide login button for verified users
    goToDashboardBtn.style.display = 'block';
    
    // Redirect to dashboard
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 1200);
    
  } catch (error) {
    console.error('Email verification failed:', error);
    showError(`❌ Verification failed: ${error.message || 'Invalid or expired verification link.'}`);
    pageTitle.textContent = "Verification Failed";
    status.textContent = "We couldn't verify your email. The link may be invalid or expired.";
    
    // Show action buttons
    actionButtons.style.display = 'block';
    goToLoginBtn.style.display = 'block';
    goToDashboardBtn.style.display = 'none';
  }
}

// Handle password reset
async function handlePasswordReset() {
  try {
    // First verify the reset code
    pageTitle.textContent = "Verifying reset link...";
    status.textContent = "Please wait while we verify your password reset link.";
    
    await verifyPasswordResetCode(auth, oobCode);
    
    // Show password reset form
    pageTitle.textContent = "Reset Your Password";
    status.textContent = "Enter your new password below.";
    passwordResetForm.style.display = 'block';
    hideMessages();
    
  } catch (error) {
    console.error('Password reset verification failed:', error);
    showError(`❌ Reset failed: ${error.message || 'Invalid or expired reset link.'}`);
    pageTitle.textContent = "Reset Failed";
    status.textContent = "We couldn't verify your password reset link. The link may be invalid or expired.";
    
    // Show action buttons
    actionButtons.style.display = 'block';
    goToLoginBtn.style.display = 'block';
    goToDashboardBtn.style.display = 'none';
  }
}

// Handle password reset form submission
async function handlePasswordResetSubmit(event) {
  event.preventDefault();
  
  const newPassword = newPasswordInput.value.trim();
  const confirmPassword = confirmPasswordInput.value.trim();
  
  // Validation
  if (!newPassword || !confirmPassword) {
    showError("Please fill in both password fields.");
    return;
  }
  
  if (newPassword.length < 8) {
    showError("Password must be at least 8 characters long.");
    return;
  }
  
  const strength = checkPasswordStrength(newPassword);
  if (strength.level === 'weak') {
    showError("Password must include at least one uppercase letter, one lowercase letter, and one number.");
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showError("Passwords do not match.");
    return;
  }
  
  try {
    resetPasswordBtn.disabled = true;
    resetPasswordBtn.textContent = "Resetting...";
    
    await confirmPasswordReset(auth, oobCode, newPassword);
    
    showSuccess("✅ Password updated successfully!");
    pageTitle.textContent = "Password Reset Complete";
    status.textContent = "Your password has been updated. Please log in with your new password.";
    
    // Hide form and show action buttons
    passwordResetForm.style.display = 'none';
    actionButtons.style.display = 'block';
    goToLoginBtn.style.display = 'block';
    goToDashboardBtn.style.display = 'none';
    
    // Flag success for login page banner and redirect
    try { sessionStorage.setItem('resetPasswordSuccess', '1'); } catch(_) {}
    setTimeout(() => { window.location.href = '/login.html'; }, 1200);
    
  } catch (error) {
    console.error('Password reset failed:', error);
    showError(`❌ Reset failed: ${error.message || 'Something went wrong. Please try again.'}`);
    resetPasswordBtn.disabled = false;
    resetPasswordBtn.textContent = "Reset Password";
  }
}

// Initialize the page
async function initialize() {
  console.log('Auth action page initializing...', { mode, oobCode: oobCode ? 'present' : 'missing' });
  
  // Validate parameters
  if (!mode || !oobCode) {
    showError("❌ Invalid link. Missing required parameters.");
    pageTitle.textContent = "Invalid Link";
    status.textContent = "This link is missing required information. Please request a new verification or reset link.";
    
    actionButtons.style.display = 'block';
    goToLoginBtn.style.display = 'block';
    goToDashboardBtn.style.display = 'none';
    return;
  }
  
  // Setup password toggles
  setupPasswordToggle('toggleNewPassword', 'newPassword', 'newPasswordEyeIcon');
  setupPasswordToggle('toggleConfirmPassword', 'confirmPassword', 'confirmPasswordEyeIcon');
  
  // Setup password strength checking
  newPasswordInput.addEventListener('input', updatePasswordStrength);
  
  // Setup form submission
  passwordResetForm.addEventListener('submit', handlePasswordResetSubmit);
  
  // Setup cancel button
  cancelResetBtn.addEventListener('click', () => {
    window.location.href = '/login.html';
  });
  
  // Setup action buttons
  goToLoginBtn.addEventListener('click', () => {
    window.location.href = '/login.html';
  });
  
  goToDashboardBtn.addEventListener('click', () => {
    window.location.href = '/dashboard.html';
  });
  
  // Handle different modes
  if (mode === 'verifyEmail') {
    await handleEmailVerification();
  } else if (mode === 'resetPassword') {
    await handlePasswordReset();
  } else {
    showError(`❌ Unknown action: ${mode}`);
    pageTitle.textContent = "Invalid Action";
    status.textContent = "This link contains an unknown action. Please request a new link.";
    
    actionButtons.style.display = 'block';
    goToLoginBtn.style.display = 'block';
    goToDashboardBtn.style.display = 'none';
  }
}

// Start initialization when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);
