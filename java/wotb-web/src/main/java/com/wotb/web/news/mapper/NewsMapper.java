package com.wotb.web.news.mapper;

import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.entity.NewsArchive;
import com.wotb.web.news.entity.NewsArchiveSource;
import com.wotb.web.news.entity.NewsCategory;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class NewsMapper implements Mapper<NewsCategory, NewsDtos.Category> {
    @Override public NewsDtos.Category toDto(final NewsCategory category) {
        return new NewsDtos.Category(category.id, category.name, category.type);
    }
    public NewsDtos.Archive archive(final NewsArchive archive, final List<NewsArchiveSource> sources) {
        return new NewsDtos.Archive(archive.id, archive.source, archive.version, archive.title, archive.status,
                archive.revision, archive.categories.stream().map(this::toDto).toList(),
                sources.stream().map(source -> source.article).map(this::snapshot).toList(), archive.createdAt,
                archive.reviewedBy, archive.publishedAt, archive.errorCode);
    }
    public NewsDtos.Article snapshot(final NewsDtos.Article article) {
        return new NewsDtos.Article(article.sourceKey(), article.title(), article.sourceUrl(), article.language(),
                article.publishedAtRaw(), article.coverImageId(), article.revision(), List.copyOf(article.blocks()), null);
    }
    public NewsDtos.ArchiveSummary summary(final NewsArchive archive) {
        return new NewsDtos.ArchiveSummary(archive.id, archive.source, archive.version, archive.title, archive.status,
                archive.revision, archive.categories.stream().map(this::toDto).toList(), archive.createdAt,
                archive.reviewedBy, archive.publishedAt, archive.errorCode);
    }
}
