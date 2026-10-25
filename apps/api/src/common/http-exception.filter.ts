import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { toValidationIssues, type ValidationErrorBody } from '@flowcanvas/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * - ZodError -> 400 { issues: [{ path, message }] } so the web app can point at the broken node or field
 * - HttpException -> its own status and body
 * - anything else -> logged 500 without internals
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ZodError) {
      const body: ValidationErrorBody = { issues: toValidationIssues(exception.issues) };
      res.status(HttpStatus.BAD_REQUEST).json(body);
      return;
    }
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Internal server error' });
  }
}
