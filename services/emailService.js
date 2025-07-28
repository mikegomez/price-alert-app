const nodemailer = require('nodemailer');

// Replace with your actual mail credentials and host
const transporter = nodemailer.createTransport({
  host: 'mail.cryptotrackeralerts.net', // or use mail.yourdomain.com
  port: 465, // use 587 for STARTTLS or 465 for SSL
  secure: true, // true if port is 465
  auth: {
    user: process.env.EMAIL_USER, // e.g., noreply@cryptotrackeralerts.net
    pass: process.env.EMAIL_PASS  // your mailbox password from GreenGeeks
  }
});

// Use same for both production and development now
const getTransporter = async () => transporter;

const sendAlertEmail = async (email, symbol, currentPrice, targetPrice, alertType) => {
  try {
    const subject = `Price Alert: ${symbol} ${alertType} $${targetPrice}`;
    const htmlContent = `
      <h2>Price Alert Triggered!</h2>
      <p><strong>${symbol}</strong> has reached your target price.</p>
      <ul>
        <li>Current Price: <strong>$${currentPrice.toFixed(2)}</strong></li>
        <li>Target Price: <strong>$${targetPrice}</strong></li>
        <li>Alert Type: <strong>${alertType}</strong></li>
        <li>Time: <strong>${new Date().toLocaleString()}</strong></li>
      </ul>
    `;

    const mailOptions = {
      from: `"Crypto Tracker Alerts" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Alert email sent:', info.messageId);
  } catch (err) {
    console.error('Error sending alert email:', err);
  }
};

const sendWelcomeEmail = async (email) => {
  try {
    const mailOptions = {
      from: `"Crypto Tracker Alerts" <${process.env.EMAIL_USER}>`,
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
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent:', info.messageId);
  } catch (err) {
    console.error('Error sending welcome email:', err);
  }
};

module.exports = { sendAlertEmail, sendWelcomeEmail };
