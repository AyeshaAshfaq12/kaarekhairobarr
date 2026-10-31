import { z } from 'zod'

// Shared between client forms and server actions. Keep this file free of server-only imports.

export const CNIC_PATTERN = /^\d{5}-\d{7}-\d$/

// Normalises Pakistani mobile numbers to +923XXXXXXXXX. Returns null when not recognisable.
export function normalizePhone(input: string | null | undefined) {
  if (!input) return null
  const digits = input.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
  let local: string | null = null
  if (/^\+92\d{10}$/.test(digits)) local = digits.slice(3)
  else if (/^0092\d{10}$/.test(digits)) local = digits.slice(4)
  else if (/^92\d{10}$/.test(digits)) local = digits.slice(2)
  else if (/^0\d{10}$/.test(digits)) local = digits.slice(1)
  else if (/^3\d{9}$/.test(digits)) local = digits
  if (!local || !/^3\d{9}$/.test(local)) return null
  return `+92${local}`
}

const phoneField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((value, ctx) => {
      const normalized = normalizePhone(value)
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a Pakistani mobile number, e.g. 0300 1234567` })
        return z.NEVER
      }
      return normalized
    })

const optionalPhoneField = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null
      const normalized = normalizePhone(value)
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a Pakistani mobile number` })
        return z.NEVER
      }
      return normalized
    })

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : null))

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200)

export const signupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    password: passwordSchema,
    confirmPassword: z.string(),
    fullName: z.string().trim().min(2, 'Full name is required').max(120),
    fatherName: optionalText,
    gender: z.enum(['MALE', 'FEMALE', 'OTHER'], { errorMap: () => ({ message: 'Select a gender' }) }),
    dateOfBirth: z.coerce.date({ errorMap: () => ({ message: 'Enter your date of birth' }) }),
    phone: phoneField('Phone'),
    whatsapp: optionalPhoneField('WhatsApp'),
    city: z.string().trim().min(2, 'City is required').max(80),
    address: z.string().trim().min(5, 'Address is required').max(300),
    cnic: z.string().trim().regex(CNIC_PATTERN, 'CNIC must look like 35202-1234567-1'),
    institutionOrJob: optionalText,
    skills: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((skill) => skill.trim())
          .filter(Boolean)
          .slice(0, 20)
      ),
    availabilityHoursPerWeek: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (!value) return null
        const hours = Number(value)
        if (!Number.isInteger(hours) || hours < 0 || hours > 80) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Hours must be a whole number from 0 to 80' })
          return z.NEVER
        }
        return hours
      }),
    emergencyName: z.string().trim().min(2, 'Emergency contact name is required').max(120),
    emergencyPhone: phoneField('Emergency phone'),
    howHeard: optionalText,
    referrerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((value) => (value ? value : null))
      .pipe(z.string().email('Referrer must be an email').nullable()),
    inviteToken: optionalText,
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export type SignupInput = z.infer<typeof signupSchema>

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
  next: z.string().optional(),
})

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  fatherName: optionalText,
  phone: phoneField('Phone'),
  whatsapp: optionalPhoneField('WhatsApp'),
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(300),
  institutionOrJob: optionalText,
  skills: signupSchema.innerType().shape.skills,
  availabilityHoursPerWeek: signupSchema.innerType().shape.availabilityHoursPerWeek,
  emergencyName: z.string().trim().min(2).max(120),
  emergencyPhone: phoneField('Emergency phone'),
})

export const reasonSchema = z.string().trim().min(3, 'A reason is required').max(1000)

export type FieldErrors = Record<string, string[] | undefined>

export type ActionState = {
  ok?: boolean
  message?: string
  fieldErrors?: FieldErrors
}

export function formDataToObject(formData: FormData) {
  const result: Record<string, string> = {}
  formData.forEach((value, key) => {
    if (typeof value === 'string' && !(key in result)) result[key] = value
  })
  return result
}
