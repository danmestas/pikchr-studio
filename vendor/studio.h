/* Opt-in studio API, available when pikchr.c is compiled with -DPIKCHR_STUDIO.
 * Returned UTF-8 JSON is malloc-owned; release with free().
 * Geometry uses inches/y-up. Source spans use UTF-8 bytes, [start,end).
 * IDs are render-local and must not survive a source revision.
 * zClass and mFlags behave exactly as for pikchr(): PIKCHR_PLAINTEXT_ERRORS
 * (0x0001) and PIKCHR_DARK_MODE (0x0002) pass through. */
#ifndef PIKCHR_STUDIO_H
#define PIKCHR_STUDIO_H
#ifdef __cplusplus
extern "C" {
#endif
char *pikchr(const char *zText, const char *zClass, unsigned int mFlags, int *pnWidth, int *pnHeight);
char *pikchr_studio(const char *zText, const char *zClass, unsigned int mFlags);
#ifdef __cplusplus
}
#endif
#endif
