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

// saudceo@MacBook-Air-Saud flick-backend % curl -X POST \  http://localhost:4001/api/auth/login \
// -H "Content-Type: application/json" \
 // -d '{
 //  "email": "sauduk01@gmail.com",
  // "password": "SAUD11Saud"
  // }'
