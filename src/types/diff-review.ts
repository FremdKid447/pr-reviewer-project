import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsString, ValidateNested } from "class-validator";
import { DiffReviewFinding, DiffReviewFindingSeverity } from "./diff-review-finding.js";
import { Type } from "class-transformer";
import "reflect-metadata";

export class DiffReview {
    @IsString()
    @IsNotEmpty()
    summary!: string;

    @IsEnum(DiffReviewFindingSeverity)
    overall_risk!: DiffReviewFindingSeverity;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DiffReviewFinding)
    findings!: DiffReviewFinding[];

    @IsBoolean()
    no_obvious_issues!: boolean;
}