const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = `Crypto Tracker Alerts <${process.env.EMAIL_FROM || 'noreply@cryptotrackeralerts.net'}>`;

const sendAlertEmail = async (email, symbol, currentPrice, targetPrice, alertType) => {
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Price Alert: ${symbol} ${alertType} $${targetPrice}`,
      html: `
        <h2>Price Alert Triggered!</h2>
        <p><strong>${symbol}</strong> has reached your target price.</p>
        <ul>
          <li>Current Price: <strong>$${currentPrice.toFixed(2)}</strong></li>
          <li>Target Price: <strong>$${targetPrice}</strong></li>
          <li>Alert Type: <strong>${alertType}</strong></li>
          <li>Time: <strong>${new Date().toLocaleString()}</strong></li>
        </ul>
      `,
    });
    if (error) throw new Error(error.message);
    console.log('Alert email sent to', email);
  } catch (err) {
    console.error('Error sending alert email:', err);
  }
};

const sendWelcomeEmail = async (email) => {
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Welcome to Crypto Tracker Alerts!',
      html: `
        <h2>Welcome!</h2>
        <p>Thank you for signing up. You can now:</p>
        <ul>
          <li>Set price alerts</li>
          <li>Track your portfolio</li>
          <li>Simulate your investments</li>
        </ul>
      `,
    });
    if (error) throw new Error(error.message);
    console.log('Welcome email sent to', email);
  } catch (err) {
    console.error('Error sending welcome email:', err);
  }
};

const sendPasswordResetEmail = async (email, resetUrl) => {
  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Reset your Crypto Tracker Alerts password',
    html: `
      <h2>Password Reset Request</h2>
      <p>We received a request to reset your password.</p>
      <p>
        <a href="${resetUrl}" style="background-color:#3B82F6;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;">
          Reset Your Password
        </a>
      </p>
      <p>Or copy and paste this link: ${resetUrl}</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
      <p>This link will expire in 1 hour.</p>
    `,
  });
  if (error) throw new Error(error.message);
  console.log('Password reset email sent to', email);
};

module.exports = { sendAlertEmail, sendWelcomeEmail, sendPasswordResetEmail };
