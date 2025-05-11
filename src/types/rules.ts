export interface BaseRule {
    type: 'less_than' | 'between' | 'greater_than' | 'all_gp'
}

export interface LessThanRule extends BaseRule {
    type: 'less_than'
    max: number
    gp: number
}

export interface GreaterThanRule extends BaseRule {
    type: 'greater_than'
    min: number
    gp: number
}

export interface BetweenRule extends BaseRule {
    type: 'between'
    min: number
    max: number
    start_gp: number
    end_gp: number
}

export interface AllGpRule extends BaseRule {
    type: 'all_gp'
    gp: number
}

export type Rule = LessThanRule | GreaterThanRule | BetweenRule | AllGpRule
  