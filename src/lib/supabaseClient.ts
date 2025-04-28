import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://jcylgbtifwpcjncnnfok.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjeWxnYnRpZndwY2puY25uZm9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NTg3NDAsImV4cCI6MjA2MTQzNDc0MH0.ocDsO4p3ZXP-B8eqyIi4onC1RqeYMyY2q50y4xTlqHs'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
