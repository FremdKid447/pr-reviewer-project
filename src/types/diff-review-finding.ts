import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsString, Max, Min, ValidateNested } from "class-validator";

export enum DiffReviewFindingSeverity {
    low = "low",
    medium = "medium",
    high = "high",
    critical = "critical",
}

export enum DiffReviewFindingCategory {
    bug_risk = "bug_risk",
    missing_test = "missing_test",
    naming = "naming",
    maintainability = "maintainability",
    security = "security",
    performance = "performance",
    error_handling = "error_handling",
    logic = "logic",
}

export class DiffReviewFinding {
    @IsString()
    @IsNotEmpty()
    id!: string;

    @IsEnum(DiffReviewFindingSeverity)
    severity!: DiffReviewFindingSeverity;

    @IsEnum(DiffReviewFindingCategory)
    category!: DiffReviewFindingCategory;

    @IsString()
    @IsNotEmpty()
    title!: string;

    @IsString()
    @IsNotEmpty()
    description!: string;

    @IsString()
    @IsNotEmpty()
    file!: string;

    @IsNumber()
    @Min(1)
    line_hint!: number;

    @IsString()
    @IsNotEmpty()
    evidence!: string;

    @IsString()
    @IsNotEmpty()
    suggestion!: string;

    @IsNumber()
    @Min(0)
    @Max(100)
    confidence!: number;
}
