package com.wotbtools.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Test-only external content URI exercises ContentResolver in a separate test-APK process. */
public final class ReplayFixtureProvider extends ContentProvider {
    public static final String NAME = "random-battle-example.wotbreplay";
    public static final String URI = "content://com.wotbtools.app.test.replays/" + NAME;

    @Override public boolean onCreate() { return true; }

    private File fixture(Uri uri) throws FileNotFoundException {
        if (!URI.equals(uri.toString())) throw new FileNotFoundException("Unknown fixture");
        File file = new File(getContext().getCacheDir(), NAME);
        if (!file.isFile()) {
            try (InputStream source = getContext().getAssets().open(NAME);
                 FileOutputStream destination = new FileOutputStream(file)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = source.read(buffer)) != -1) destination.write(buffer, 0, count);
            } catch (IOException error) {
                throw new FileNotFoundException("Fixture unavailable");
            }
        }
        return file;
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) {
        try {
            File file = fixture(uri);
            String[] columns = projection == null
                ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            Object[] row = new Object[columns.length];
            for (int index = 0; index < columns.length; index++)
                row[index] = OpenableColumns.DISPLAY_NAME.equals(columns[index]) ? NAME : file.length();
            MatrixCursor cursor = new MatrixCursor(columns);
            cursor.addRow(row);
            return cursor;
        } catch (FileNotFoundException error) { return null; }
    }

    @Override public String getType(Uri uri) { return "application/octet-stream"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fixture(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
