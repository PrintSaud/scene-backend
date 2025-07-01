// userValidators.js

const Joi = require('joi');

// For registering new users
const registerValidation = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

// For logging in users (or another purpose)
const loginValidation = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

module.exports = {
  registerValidation,
  loginValidation,
};
