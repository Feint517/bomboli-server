import { Controller, Get, Query } from '@nestjs/common';

import { Public } from '@common/decorators/public.decorator';

import { SearchResponseDto } from './dto/discovery-response.dto';
import { SearchDto } from './dto/search.dto';
import { SearchService } from './search.service';

@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get()
  query(@Query() dto: SearchDto): Promise<SearchResponseDto> {
    return this.search.search(dto);
  }
}
