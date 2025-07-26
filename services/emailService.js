const nodemailer = require('nodemailer');

// Email configuration
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your preferred email service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // Use app-specific password for Gmail
  }
});

// For development, use Ethereal (fake SMTP)
const createTestAccount = async () => {
  if (process.env.NODE_ENV === 'development') {
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
  }
  return transporter;
};

// Send price alert email
const sendAlertEmail = async (email, symbol, currentPrice, targetPrice, alertType) => {
  try {
    const testTransporter = await createTestAccount();
    
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
      <p>This is an automated alert from your Price Alert System.</p>
    `;

    const mailOptions = {
      from: process.env.EMAIL_USER || 'alerts@pricetracker.com',
      to: email,
      subject: subject,
      html: htmlContent
    };

    const info = await testTransporter.sendMail(mailOptions);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    
    console.log('Alert email sent successfully');
  } catch (error) {
    console.error('Error sending alert email:', error);
  }
};

// Send welcome email
const sendWelcomeEmail = async (email) => {
  try {
    const testTransporter = await createTestAccount();
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'welcome@pricetracker.com',
      to: email,
      subject: 'Welcome to Price Alert System!',
      html: `
        <h2>Welcome to Price Alert System!</h2>
        <p>Thank you for signing up. You can now:</p>
        <ul>
          <li>Set price alerts for your favorite stocks</li>
          <li>Track your paper trading portfolio</li>
          <li>Monitor your investment performance</li>
        </ul>
        <p>Start by creating your first price alert!</p>
      `
    };

    const info = await testTransporter.sendMail(mailOptions);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Welcome email preview:', nodemailer.getTestMessageUrl(info));
    }
    
    console.log('Welcome email sent successfully');
  } catch (error) {
    console.error('Error sending welcome email:', error);
  }
};

module.exports = { sendAlertEmail, sendWelcomeEmail };