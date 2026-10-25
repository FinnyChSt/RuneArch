import { type PipeTransform } from '@nestjs/common';
import { type z } from 'zod';

/** Parses a request value with a shared Zod schema; failures become 400s via the exception filter */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return this.schema.parse(value);
  }
}
