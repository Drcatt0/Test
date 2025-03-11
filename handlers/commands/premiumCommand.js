/**
 * Premium Command Handler
 */
const premiumUsersModel = require('../../models/premiumUsers');

/**
 * /premium Command - Show premium info and handle redemption
 */
async function handler(ctx) {
  const userId = ctx.message.from.id;
  const chatId = ctx.message.chat.id;
  const args = ctx.message.text.split(' ').slice(1);
  
  // Check if they're already premium
  if (premiumUsersModel.isPremiumUser(userId)) {
    const userDetails = premiumUsersModel.getPremiumUserDetails(userId);
    const expiryDate = userDetails.expiresAt;
    const formattedDate = expiryDate.toLocaleDateString() + ' ' + expiryDate.toLocaleTimeString();
    
    return ctx.reply(
      "✨ *You already have Premium access!* ✨\n\n" +
      `Your premium subscription is valid until: *${formattedDate}*\n\n` +
      "Premium features include:\n" +
      "• Unlimited recording duration\n" +
      "• No recording cooldown period\n" +
      "• Higher quality recordings\n" +
      "• Automatic goal recording\n" +
      "• Unlimited monitored streamers\n\n" +
      "Premium keys are valid for 30 days from activation.",
      { parse_mode: 'Markdown' }
    );
  }
  
  // Check if they're providing a key
  if (args.length > 0) {
    const key = args[0].trim().toUpperCase();
    
    // Validate the key
    const validation = premiumUsersModel.validatePremiumKey(key);
    
    if (validation.valid) {
      // Mark the key as used
      premiumUsersModel.markKeyAsUsed(key);
      
      // Add the user to premium users
      const result = await premiumUsersModel.addPremiumUser(
        userId, 
        ctx.message.from.username || 'Unknown',
        key
      );
      
      if (result.success) {
        const expiryDate = result.expiryDate;
        
        return ctx.reply(
          "🎉 *Congratulations!* 🎉\n\n" +
          "Your premium key has been successfully activated!\n\n" +
          "You now have access to all premium features:\n" +
          "• Unlimited recording duration\n" +
          "• No recording cooldown period\n" +
          "• Higher quality recordings\n" +
          "• Automatic goal recording\n" +
          "• Unlimited monitored streamers\n\n" +
          `Your premium access is valid until: *${expiryDate.toLocaleDateString()}*`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      return ctx.reply(
        "❌ *Invalid or already used key*\n\n" +
        "The key you entered is either invalid or has already been used.\n\n" +
        "To get a valid premium key, please use the payment link below.",
        { parse_mode: 'Markdown' }
      );
    }
  }
  
  // If no key provided, show premium info
  const paymentMessage = 
    "💎 *Premium Access - Only $2* 💎\n\n" +
    "Upgrade to Premium and unlock:\n" +
    "• Unlimited recording duration\n" +
    "• No recording cooldown period (free users: 3 minute cooldown)\n" +
    "• Higher quality recordings\n" +
    "• Automatic goal recording\n" +
    "• Unlimited monitored streamers\n\n" +
    "To purchase premium, send $2 to one of these payment options:\n" +
    "• PayPal: yourpaypal@example.com\n" +
    "• Bitcoin: bc1q...\n\n" +
    "After payment, message @yourusername with your payment receipt to receive your premium key.\n\n" +
    "Premium keys are valid for 30 days from activation.\n\n" +
    "To redeem a key, type:\n" +
    "`/premium YOUR-KEY-HERE`";
  
  return ctx.reply(paymentMessage, { parse_mode: 'Markdown' });
}

module.exports = {
  handler
};
