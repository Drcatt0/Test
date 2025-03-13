/**
 * Enhanced Start Command Handler
 * Shows welcome message, user agreement, and help menu
 */
const { Markup } = require('telegraf');

/**
 * /start Command - Shows welcome message, agreement, and help menu
 */
async function handler(ctx) {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || 'there';
  
  // Show user agreement first
  const agreementMessage = 
    "📢 *Welcome to Stripchat Monitor Bot!*\n\n" +
    "This bot allows you to monitor and record streams from Stripchat.\n\n" +
    
    "⚠️ *User Agreement:*\n" +
    "• You must be at least 18 years old to use this bot.\n" +
    "• You are responsible for complying with the laws in your jurisdiction.\n" +
    "• The bot creator is not responsible for how you use this bot.\n" +
    "• Recordings should be for personal use only.\n" +
    "• Redistribution of recorded content may violate copyright laws.\n" +
    "• Usage of this bot may violate Stripchat's Terms of Service.\n\n" +
    
    "By continuing to use this bot, you agree to these terms.\n\n" +
    
    "Would you like to continue?";
  
  // Create agreement buttons
  const agreeMarkup = Markup.inlineKeyboard([
    Markup.button.callback('✅ I agree & I am 18+', `agree_terms:${userId}`),
    Markup.button.callback('❌ I decline', `decline_terms:${userId}`)
  ]);
  
  await ctx.reply(agreementMessage, {
    parse_mode: 'Markdown',
    ...agreeMarkup
  });
}

/**
 * Show help message after agreement
 */
async function showHelpAfterAgreement(ctx) {
  const username = ctx.from.username || 'there';
  
  // Welcome message
  const welcomeMessage = 
    `👋 Hello, @${username}!\n\n` +
    "Thank you for agreeing to the terms. Here's how to use this bot:";
  
  await ctx.reply(welcomeMessage);
  
  // Now show the help menu
  const helpCommand = require('./helpCommand');
  await helpCommand.handler(ctx);
}

module.exports = {
  handler,
  actions: [
    {
      pattern: /^agree_terms:(\d+)$/,
      handler: async (ctx) => {
        const userId = parseInt(ctx.match[1], 10);
        
        // Verify it's the same user who initiated
        if (userId !== ctx.from.id) {
          return ctx.answerCbQuery("This button is not for you!");
        }
        
        await ctx.answerCbQuery("Welcome! Let's get started.");
        
        // Delete the agreement message
        try {
          await ctx.deleteMessage();
        } catch (e) {
          console.error("Could not delete agreement message:", e);
        }
        
        // Show help after agreement
        await showHelpAfterAgreement(ctx);
      }
    },
    {
      pattern: /^decline_terms:(\d+)$/,
      handler: async (ctx) => {
        const userId = parseInt(ctx.match[1], 10);
        
        // Verify it's the same user who initiated
        if (userId !== ctx.from.id) {
          return ctx.answerCbQuery("This button is not for you!");
        }
        
        await ctx.answerCbQuery("You have declined the terms.");
        
        // Delete the agreement message
        try {
          await ctx.deleteMessage();
        } catch (e) {
          console.error("Could not delete agreement message:", e);
        }
        
        // Send declined message
        await ctx.reply(
          "You have declined the user agreement. You will not be able to use this bot.\n\n" +
          "If you change your mind, type /start to see the agreement again."
        );
      }
    }
  ]
};